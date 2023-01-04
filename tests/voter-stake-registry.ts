import { VoterStakeRegistry } from "@helium/idls/lib/types/voter_stake_registry";
import {
  createAtaAndMint,
  createMint,
  createMintInstructions,
  sendInstructions,
  toBN,
  truthy,
} from "@helium/spl-utils";
import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import {
  getGovernanceProgramVersion,
  getTokenOwnerRecordAddress,
  getVoteRecord,
  GovernanceConfig,
  GoverningTokenConfigAccountArgs,
  GoverningTokenType,
  MintMaxVoteWeightSource,
  Vote,
  VoteThreshold,
  VoteThresholdType,
  VoteTipping,
  VoteType,
  withCastVote,
  withCreateGovernance,
  withCreateProposal,
  withCreateRealm,
  withCreateTokenOwnerRecord,
  withRelinquishVote,
  withSetRealmConfig,
  withSignOffProposal,
  YesNoVote,
} from "@solana/spl-governance";
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Keypair,
  PublicKey, TransactionInstruction
} from "@solana/web3.js";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  init,
  nftVoteRecordKey,
  positionKey,
  PROGRAM_ID
} from "../packages/voter-stake-registry-sdk/src";
import { getUnixTimestamp } from "./utils/solana";
import { SPL_GOVERNANCE_PID } from "./utils/vsr";

chai.use(chaiAsPromised);

const MIN_LOCKUP = 15811200; // 6 months
const MAX_LOCKUP = MIN_LOCKUP * 8;
const SCALE = 100;
const GENESIS_MULTIPLIER = 3;
const SECS_PER_DAY = 60 * 60 * 24;

describe("voter-stake-registry", () => {
  anchor.setProvider(anchor.AnchorProvider.local("http://127.0.0.1:8899"));

  let program: Program<VoterStakeRegistry>;
  let registrar: PublicKey;
  let hntMint: PublicKey;
  let realm: PublicKey;
  let programVersion: number;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const me = provider.wallet.publicKey;

  beforeEach(async () => {
    program = await init(
      provider,
      PROGRAM_ID,
      anchor.workspace.VoterStakeRegistry.idl
    );
    hntMint = await createMint(provider, 8, me, me);
    await createAtaAndMint(provider, hntMint, toBN(10000000000, 8));
    programVersion = await getGovernanceProgramVersion(
      program.provider.connection,
      SPL_GOVERNANCE_PID
    );
    // Create Realm
    const name = `Realm-${new Keypair().publicKey.toBase58().slice(0, 6)}`;
    const realmAuthorityPk = me;
    let instructions: TransactionInstruction[] = [];
    realm = await withCreateRealm(
      instructions,
      SPL_GOVERNANCE_PID,
      programVersion,
      name,
      realmAuthorityPk,
      hntMint,
      me,
      undefined,
      MintMaxVoteWeightSource.FULL_SUPPLY_FRACTION,
      new anchor.BN(1)
    );

    await withSetRealmConfig(
      instructions,
      SPL_GOVERNANCE_PID,
      programVersion,
      realm,
      me,
      undefined,
      MintMaxVoteWeightSource.FULL_SUPPLY_FRACTION,
      new anchor.BN(1),
      new GoverningTokenConfigAccountArgs({
        voterWeightAddin: program.programId,
        maxVoterWeightAddin: undefined,
        tokenType: GoverningTokenType.Liquid,
      }),
      undefined,
      me
    );

    const {
      instruction: createRegistrar,
      pubkeys: { registrar: rkey },
    } = await program.methods
      .initializeRegistrarV0({
        positionUpdateAuthority: null
      })
      .accounts({
        realm: realm,
        realmGoverningTokenMint: hntMint,
      })
      .prepare();
    registrar = rkey!;
    instructions.push(createRegistrar);

    // Configure voting mint
    const oneWeekFromNow = Number(await getUnixTimestamp(provider)) + 60 * 60 * 24 * 7;
    instructions.push(
      await program.methods
        .configureVotingMintV0({
          idx: 0, // idx
          digitShift: 0, // digit shift
          lockedVoteWeightScaledFactor: new anchor.BN(1_000_000_000),
          minimumRequiredLockupSecs: new anchor.BN(MIN_LOCKUP),
          maxExtraLockupVoteWeightScaledFactor: new anchor.BN(SCALE),
          genesisVotePowerMultiplier: GENESIS_MULTIPLIER,
          genesisVotePowerMultiplierExpirationTs: new anchor.BN(oneWeekFromNow),
          lockupSaturationSecs: new anchor.BN(MAX_LOCKUP),
        })
        .accounts({
          registrar,
          mint: hntMint,
        })
        .remainingAccounts([
          {
            pubkey: hntMint,
            isSigner: false,
            isWritable: false,
          },
        ])
        .instruction()
    );

    await sendInstructions(provider, instructions, []);
  });

  async function createAndDeposit(
    lockupAmount: number,
    periods: number,
    kind: any = { cliff: {} },
    owner?: Keypair
  ): Promise<{ mint: PublicKey; position: PublicKey }> {
    const mintKeypair = Keypair.generate();
    const position = positionKey(mintKeypair.publicKey)[0];
    const instructions: TransactionInstruction[] = [];
    instructions.push(
      ...(await createMintInstructions(
        provider,
        0,
        position,
        position,
        mintKeypair
      ))
    );
    instructions.push(
      await program.methods
        .initializePositionV0({
          kind,
          periods,
        })
        .accounts({
          // lock for 6 months
          registrar,
          mint: mintKeypair.publicKey,
          depositMint: hntMint,
          positionAuthority: owner?.publicKey,
        })
        .instruction()
    );

    // deposit some hnt
    instructions.push(
      await program.methods
        .depositV0({ amount: toBN(lockupAmount, 8) })
        .accounts({
          registrar,
          position,
          mint: hntMint,
        })
        .instruction()
    );
    await sendInstructions(
      provider,
      instructions,
      [mintKeypair, owner].filter(truthy)
    );

    return { position, mint: mintKeypair.publicKey };
  }

  it("should allow me to create a position and deposit tokens", async () => {
    const { mint, position } = await createAndDeposit(10, 183);
    const positionAccount = await program.account.positionV0.fetch(position);

    expect(positionAccount.amountDepositedNative.toNumber()).to.eq(
      toBN(10, 8).toNumber()
    );
    expect(positionAccount.mint.toBase58()).to.eq(mint.toBase58());
    expect(positionAccount.registrar.toBase58()).to.eq(registrar.toBase58());
    expect(positionAccount.numActiveVotes).to.eq(0);

    const bal = await provider.connection.getTokenAccountBalance(
      await getAssociatedTokenAddress(mint, me)
    );
    expect(bal.value.uiAmount).to.eq(1);
  });

  describe("with proposal", async () => {
    let proposal: PublicKey;
    let governance: PublicKey;
    let proposalOwner: PublicKey;

    beforeEach(async () => {
      const instructions: TransactionInstruction[] = [];
      const tokenOwnerRecord = await getTokenOwnerRecordAddress(
        SPL_GOVERNANCE_PID,
        realm,
        hntMint,
        me
      );
      await withCreateTokenOwnerRecord(
        instructions,
        SPL_GOVERNANCE_PID,
        programVersion,
        realm,
        me,
        hntMint,
        me
      );
      const { position, mint } = await createAndDeposit(10000, 200);
      const {
        pubkeys: { voterWeightRecord },
        instruction,
      } = await program.methods
        .updateVoterWeightRecordV0({
          voterWeightAction: {
            createProposal: {},
          },
          owner: me,
        })
        .accounts({
          registrar,
        })
        .remainingAccounts([
          {
            pubkey: await getAssociatedTokenAddress(mint, me),
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: position,
            isWritable: false,
            isSigner: false,
          },
        ])
        .prepare();
      instructions.push(instruction);
      proposalOwner = tokenOwnerRecord;
      governance = await withCreateGovernance(
        instructions,
        SPL_GOVERNANCE_PID,
        programVersion,
        realm,
        Keypair.generate().publicKey,
        new GovernanceConfig({
          minCommunityTokensToCreateProposal: new anchor.BN(1),
          minInstructionHoldUpTime: 100,
          maxVotingTime: MAX_LOCKUP * 8, // set incredibly long for testing
          minCouncilTokensToCreateProposal: new anchor.BN(1),
          councilVoteThreshold: new VoteThreshold({
            type: VoteThresholdType.YesVotePercentage,
            value: 50,
          }),
          communityVoteThreshold: new VoteThreshold({
            type: VoteThresholdType.YesVotePercentage,
            value: 50,
          }),
          councilVetoVoteThreshold: new VoteThreshold({
            type: VoteThresholdType.YesVotePercentage,
            value: 50,
          }),
          communityVetoVoteThreshold: new VoteThreshold({
            type: VoteThresholdType.YesVotePercentage,
            value: 50,
          }),
          councilVoteTipping: VoteTipping.Early,
          votingCoolOffTime: 0,
          depositExemptProposalCount: 10,
        }),
        tokenOwnerRecord,
        me,
        me,
        voterWeightRecord
      );
      proposal = await withCreateProposal(
        instructions,
        SPL_GOVERNANCE_PID,
        programVersion,
        realm,
        governance,
        tokenOwnerRecord,
        "Test Proposal",
        "",
        hntMint,
        me,
        undefined,
        VoteType.SINGLE_CHOICE,
        ["Approve"],
        true,
        me,
        voterWeightRecord
      );
      await withSignOffProposal(
        instructions,
        SPL_GOVERNANCE_PID,
        programVersion,
        realm,
        governance,
        proposal,
        me,
        undefined,
        proposalOwner
      );
      await sendInstructions(provider, instructions);
    });

    let voteTestCases = [
      {
        name: "genesis constant (within genesis)",
        lockupAmount: 10000,
        periods: 200,
        delay: 0, // days
        fastForward: 60, // days
        kind: { constant: {} },
        expectedVeHnt:
          10000 *
          GENESIS_MULTIPLIER *
          (1 +
            ((SCALE - 1) * (SECS_PER_DAY * 200 - MIN_LOCKUP)) /
              (MAX_LOCKUP - MIN_LOCKUP)),
      },
      {
        name: "genesis cliff (within genesis)",
        lockupAmount: 10000,
        periods: 200,
        delay: 0, // days
        fastForward: 60, // days
        kind: { cliff: {} },
        expectedVeHnt:
          10000 *
          GENESIS_MULTIPLIER *
          (1 +
            ((SCALE - 1) * (SECS_PER_DAY * 200 - MIN_LOCKUP)) /
              (MAX_LOCKUP - MIN_LOCKUP)) *
          ((200 - 60) / 200),
      },
      {
        name: "genesis constant (outside of genesis)",
        lockupAmount: 10000,
        periods: 200,
        delay: 0, // days
        fastForward: 201, // days
        kind: { constant: {} },
        expectedVeHnt:
          10000 *
          (1 +
            ((SCALE - 1) * (SECS_PER_DAY * 200 - MIN_LOCKUP)) /
              (MAX_LOCKUP - MIN_LOCKUP)),
      },
      {
        name: "cliff (outside genesis)",
        lockupAmount: 10000,
        periods: 200,
        delay: 7, // days
        fastForward: 60, // days
        kind: { cliff: {} },
        expectedVeHnt:
          10000 *
          (1 +
            ((SCALE - 1) * (SECS_PER_DAY * 200 - MIN_LOCKUP)) /
              (MAX_LOCKUP - MIN_LOCKUP)) *
          ((200 - 60) / 200),
      },
    ];
    voteTestCases.forEach((testCase) => {
      const depositor = Keypair.generate();
      it("should allow me to vote with " + testCase.name, async () => {
        await program.methods
          .setTimeOffsetV0(new anchor.BN(testCase.delay * SECS_PER_DAY))
          .accounts({ registrar })
          .rpc();

        const instructions: TransactionInstruction[] = [];
        const { position, mint } = await createAndDeposit(
          testCase.lockupAmount,
          testCase.periods,
          testCase.kind,
          depositor
        );
        await program.methods
          .setTimeOffsetV0(
            new anchor.BN(
              (testCase.delay + testCase.fastForward) * SECS_PER_DAY
            )
          )
          .accounts({ registrar })
          .rpc();
        const tokenOwnerRecord = await getTokenOwnerRecordAddress(
          SPL_GOVERNANCE_PID,
          realm,
          hntMint,
          depositor.publicKey
        );

        await withCreateTokenOwnerRecord(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          depositor.publicKey,
          hntMint,
          me
        );

        const {
          pubkeys: { voterWeightRecord },
          instruction,
        } = await program.methods
          .castVoteV0({
            proposal,
            owner: depositor.publicKey,
          })
          .accounts({
            registrar,
            voterAuthority: depositor.publicKey,
            voterTokenOwnerRecord: tokenOwnerRecord,
          })
          .remainingAccounts([
            {
              pubkey: await getAssociatedTokenAddress(
                mint,
                depositor.publicKey
              ),
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: position,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: await nftVoteRecordKey(proposal, mint)[0],
              isSigner: false,
              isWritable: true,
            },
          ])
          .prepare();
        instructions.push(instruction);

        const vote = await withCastVote(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          governance,
          proposal,
          proposalOwner,
          tokenOwnerRecord,
          depositor.publicKey,
          hntMint,
          Vote.fromYesNoVote(YesNoVote.Yes),
          me,
          voterWeightRecord
        );

        await sendInstructions(provider, instructions, [depositor]);

        const voteRecord = await getVoteRecord(provider.connection, vote);
        expectBnAccuracy(
          toBN(testCase.expectedVeHnt, 8),
          voteRecord.account.getYesVoteWeight() as anchor.BN,
          0.00001
        );
      });
    });

    describe("with an active vote", async () => {
      let position: PublicKey;
      let mint: PublicKey;
      let tokenOwnerRecord: PublicKey;
      let voteRecord: PublicKey;
      let voterWeightRecord: PublicKey;

      beforeEach(async () => {
        const instructions: TransactionInstruction[] = [];
        tokenOwnerRecord = await getTokenOwnerRecordAddress(
          SPL_GOVERNANCE_PID,
          realm,
          hntMint,
          me
        );

        ({ position, mint } = await createAndDeposit(10000, 200));

        const {
          pubkeys: { voterWeightRecord: vw },
          instruction,
        } = await program.methods
          .castVoteV0({
            proposal,
            owner: me,
          })
          .accounts({
            registrar,
            voterAuthority: me,
            voterTokenOwnerRecord: tokenOwnerRecord,
          })
          .remainingAccounts([
            {
              pubkey: await getAssociatedTokenAddress(mint, me),
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: position,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: await nftVoteRecordKey(proposal, mint)[0],
              isSigner: false,
              isWritable: true,
            },
          ])
          .prepare();
        voterWeightRecord = vw!;
        instructions.push(instruction);

        voteRecord = await withCastVote(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          governance,
          proposal,
          proposalOwner,
          tokenOwnerRecord,
          me,
          hntMint,
          Vote.fromYesNoVote(YesNoVote.Yes),
          me,
          voterWeightRecord
        );

        await sendInstructions(provider, instructions);
      });

      it("should not allow me to vote twice", async () => {
        const instructions: TransactionInstruction[] = [];
        const {
          pubkeys: { voterWeightRecord: r },
          instruction,
        } = await program.methods
          .castVoteV0({
            proposal,
            owner: me,
          })
          .accounts({
            registrar,
            voterAuthority: me,
            voterTokenOwnerRecord: tokenOwnerRecord,
          })
          .remainingAccounts([
            {
              pubkey: await getAssociatedTokenAddress(mint, me),
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: position,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: await nftVoteRecordKey(proposal, mint)[0],
              isSigner: false,
              isWritable: true,
            },
          ])
          .prepare();
        voterWeightRecord = r!;
        instructions.push(instruction);

        await withCastVote(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          governance,
          proposal,
          proposalOwner,
          tokenOwnerRecord,
          me,
          hntMint,
          Vote.fromYesNoVote(YesNoVote.Yes),
          me,
          voterWeightRecord
        );

        try {
          await sendInstructions(provider, instructions);
        } catch (e: any) {
          expect(e.InstructionError[1].Custom).to.eq(6045);
        }
      });

      it("should not allow me to vote twice after transferring", async () => {
        const voter = Keypair.generate();
        const instructions: TransactionInstruction[] = [];
        const tokenOwnerRecord2 = await getTokenOwnerRecordAddress(
          SPL_GOVERNANCE_PID,
          realm,
          hntMint,
          voter.publicKey
        );
        await withCreateTokenOwnerRecord(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          voter.publicKey,
          hntMint,
          me
        );
        instructions.push(
          createAssociatedTokenAccountInstruction(
            me,
            await getAssociatedTokenAddress(mint, voter.publicKey),
            voter.publicKey,
            mint
          ),
          await createTransferInstruction(
            await getAssociatedTokenAddress(mint, me),
            await getAssociatedTokenAddress(mint, voter.publicKey),
            me,
            1
          )
        );

        const {
          pubkeys: { voterWeightRecord },
          instruction,
        } = await program.methods
          .castVoteV0({
            proposal,
            owner: voter.publicKey,
          })
          .accounts({
            registrar,
            voterAuthority: voter.publicKey,
            voterTokenOwnerRecord: tokenOwnerRecord2,
          })
          .remainingAccounts([
            {
              pubkey: await getAssociatedTokenAddress(mint, voter.publicKey),
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: position,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: await nftVoteRecordKey(proposal, mint)[0],
              isSigner: false,
              isWritable: true,
            },
          ])
          .prepare();
        instructions.push(instruction);

        await withCastVote(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          governance,
          proposal,
          proposalOwner,
          tokenOwnerRecord2,
          voter.publicKey,
          hntMint,
          Vote.fromYesNoVote(YesNoVote.No),
          me,
          voterWeightRecord
        );

        try {
          await sendInstructions(provider, instructions, [voter]);
        } catch (e: any) {
          expect(e.InstructionError[1].Custom).to.eq(6045);
        }
      });

      it("should allow me to relinquish my vote", async () => {
        const instructions: TransactionInstruction[] = [];
        await withRelinquishVote(
          instructions,
          SPL_GOVERNANCE_PID,
          programVersion,
          realm,
          governance,
          proposal,
          tokenOwnerRecord,
          hntMint,
          voteRecord,
          me,
          me
        );
        instructions.push(
          await program.methods
            .relinquishVoteV0()
            .accounts({
              registrar,
              voterAuthority: me,
              voterTokenOwnerRecord: tokenOwnerRecord,
              proposal,
              governance,
              voterWeightRecord,
              voteRecord,
              beneficiary: me,
            })
            .remainingAccounts([
              {
                pubkey: nftVoteRecordKey(proposal, mint)[0],
                isWritable: true,
                isSigner: false,
              },
              {
                pubkey: position,
                isWritable: true,
                isSigner: false,
              },
            ])
            .instruction()
        );
        await sendInstructions(provider, instructions);
      });

      it("should not allow me to move tokens to another position while vote is active", async () => {
        const { position: newPos } = await createAndDeposit(10, 185);
        await expect(
          program.methods
            .transferV0({ amount: toBN(10, 8) })
            .accounts({
              sourcePosition: position,
              targetPosition: newPos,
              depositMint: hntMint,
            })
            .rpc()
        ).to.eventually.be.rejectedWith(
          "AnchorError caused by account: source_position. Error Code: ActiveVotesExist. Error Number: 6056. Error Message: Cannot change a position while active votes exist."
        );
      });
    });
  });

  describe("with position", async () => {
    let position: PublicKey;

    beforeEach(async () => {
      ({ position } = await createAndDeposit(100, 184));
    });

    it("should allow me to withdraw and close a position after lockup", async () => {
      await program.methods
        .setTimeOffsetV0(new anchor.BN(185 * SECS_PER_DAY))
        .accounts({ registrar })
        .rpc({ skipPreflight: true });

      await program.methods
        .withdrawV0({ amount: toBN(100, 8) })
        .accounts({ position, depositMint: hntMint })
        .rpc({ skipPreflight: true });

      const positionAccount = await program.account.positionV0.fetch(position);
      expect(positionAccount.amountDepositedNative.toNumber()).to.equal(0);

      await program.methods.closePositionV0().accounts({ position }).rpc();
      expect(await program.account.positionV0.fetchNullable(position)).to.be
        .null;
    });

    it("should not allow me to withdraw a position before lockup", async () => {
      await expect(
        program.methods
          .withdrawV0({ amount: toBN(100, 8) })
          .accounts({ position, depositMint: hntMint })
          .rpc()
      ).to.be.rejected;
    });

    it("should allow me to extend my lockup", async () => {
      await program.methods
        .resetLockupV0({
          kind: { constant: {} },
          periods: 185,
        })
        .accounts({
          position,
        })
        .rpc({ skipPreflight: true });

      const positionAcc = await program.account.positionV0.fetch(position);
      expect(Boolean(positionAcc.lockup.kind.constant)).to.be.true;
      expect(
        positionAcc.lockup.endTs.sub(positionAcc.lockup.startTs).toNumber()
      ).to.equal(185 * SECS_PER_DAY);
    });

    it("should allow me to move tokens to a position with a greater or equal lockup", async () => {
      const { position: newPos } = await createAndDeposit(10, 185);
      await program.methods
        .transferV0({ amount: toBN(10, 8) })
        .accounts({
          sourcePosition: position,
          targetPosition: newPos,
          depositMint: hntMint,
        })
        .rpc({ skipPreflight: true });

      const newPosAcc = await program.account.positionV0.fetch(newPos);
      const oldPosAcc = await program.account.positionV0.fetch(position);
      expect(newPosAcc.amountDepositedNative.toNumber()).to.equal(
        toBN(20, 8).toNumber()
      );
      expect(oldPosAcc.amountDepositedNative.toNumber()).to.equal(
        toBN(90, 8).toNumber()
      );
    });
  });
});

function expectBnAccuracy(
  expectedBn: anchor.BN,
  actualBn: anchor.BN,
  percentUncertainty: number
) {
  let upperBound = expectedBn.mul(new anchor.BN(1 + percentUncertainty));
  let lowerBound = expectedBn.mul(new anchor.BN(1 - percentUncertainty));
  try {
    expect(upperBound.gte(actualBn)).to.be.true;
    expect(lowerBound.lte(actualBn)).to.be.true;
  } catch (e) {
    console.error(
      "Expected",
      expectedBn.toString(),
      "Actual",
      actualBn.toString()
    );
    throw e;
  }
}
