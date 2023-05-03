import * as anchor from "@coral-xyz/anchor";
import { AccountInfo, Commitment, GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { Op, Sequelize } from "sequelize";
import { SOLANA_URL } from "../env";
import database from "./database";
import { defineIdlModels } from "./defineIdlModels";
import { sanitizeAccount } from "./sanitizeAccount";
import { chunks } from "@helium/spl-utils";
import { Program } from "@coral-xyz/anchor";

export type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

export const truthy = <T>(value: T): value is Truthy<T> => !!value;

interface UpsertProgramAccountsArgs {
  programId: PublicKey;
  accounts: {
    type: string;
    table?: string;
    schema?: string;
  }[];
  sequelize?: Sequelize;
}

const accumulateGpa = async(provider: anchor.Provider, program: Program, type: string, programId: PublicKey, filters: GetProgramAccountsFilter[]): 
  Promise<
    Array<{
      publicKey: PublicKey;
      account: AccountInfo<Buffer>;
    }>
  > => {
    console.log("starting accumulation for type:", type);
  const startTime = performance.now()

  let resp: Array<{
    pubkey: PublicKey;
    account: AccountInfo<Buffer>;
  }>;
  try {
    resp = await provider.connection.getProgramAccounts(programId, {
      commitment: provider.connection.commitment,
      filters,
      dataSlice: {
        offset: 0,
        length: 1,
      }
    });
  } catch (err) {
    const endTime = performance.now()
    console.log(`Failed after ${endTime - startTime} milliseconds`);
    return [];
  }
  const endTime = performance.now()
  console.log(`Succeeded ${endTime - startTime} milliseconds`)

  console.log(`Fetched ${resp.length} accounts`);
  const respChunks = chunks(resp, 100);

  const finalAccounts:  Array<{publicKey: PublicKey; account: AccountInfo<Buffer>;}>= [];
  for (let i = 0; i < respChunks.length; i++) {
    process.stdout.write(`\r${i}/${respChunks.length}`);
    const chunk = respChunks[i];
    const accInfos = await provider.connection.getMultipleAccountsInfo(chunk.map((x) => x.pubkey));
    const accs = accInfos
        .map((acc, j) => {
          // ignore accounts we cant decode
          try {
            return {
              publicKey: chunk[j].pubkey,
              account: program.coder.accounts.decode(type, acc.data),
            };
          } catch (_e) {
            console.error(`Decode error ${chunk[j].pubkey.toString()}`, _e);
            return null;
          }
        })
        .filter(truthy);
    finalAccounts.push(...accs);
  }
  console.log("");
  console.log(`Final accounts remaining: ${finalAccounts.length}`);
  return finalAccounts;
}

export const upsertProgramAccounts = async ({
  programId,
  accounts,
  sequelize = database,
}: UpsertProgramAccountsArgs) => {
  anchor.setProvider(
    anchor.AnchorProvider.local(process.env.ANCHOR_PROVIDER_URL || SOLANA_URL)
  );
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const idl = await anchor.Program.fetchIdl(programId, provider);

  if (!idl) {
    throw new Error(`unable to fetch idl for ${programId}`);
  }

  if (
    !accounts.every(({ type }) =>
      idl.accounts!.some(({ name }) => name === type)
    )
  ) {
    throw new Error("idl does not have every account type");
  }

  const program = new anchor.Program(idl, programId, provider);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.log(e);
  }

  for (const { type } of accounts) {
    const filter: { offset?: number; bytes?: string; dataSize?: number } =
      program.coder.accounts.memcmp(type, undefined);
    const coderFilters: GetProgramAccountsFilter[] = [];

    if (filter?.offset != undefined && filter?.bytes != undefined) {
      coderFilters.push({
        memcmp: { offset: filter.offset, bytes: filter.bytes },
      });
    }

    if (filter?.dataSize != undefined) {
      coderFilters.push({ dataSize: filter.dataSize });
    }

    const resp = await accumulateGpa(provider, program, type, programId, [...coderFilters]);

    const model = sequelize.models[type];
    await model.sync({ alter: true });

    const now = new Date().toISOString();
    const respChunks = chunks(resp, 1000);
    for (const chunk of respChunks) {
      const t = await sequelize.transaction();
      try {
        const updateOnDuplicateFields: string[] = Object.keys(chunk[0].account);
        await model.bulkCreate(
          chunk.map(({ publicKey, account }) => ({
            address: publicKey.toBase58(),
            refreshed_at: now,
            ...sanitizeAccount(account),
          })),
          {
            transaction: t,
            updateOnDuplicate: [
              "address",
              "refreshed_at",
              ...updateOnDuplicateFields,
            ],
          }
        );

        await model.destroy({
          transaction: t,
          where: {
            refreshed_at: {
              [Op.ne]: now,
            },
          },
        });

        await t.commit();
      } catch (err) {
        await t.rollback();
        console.error("While inserting, err", err);
        throw err;
      }
    }
  }
};
