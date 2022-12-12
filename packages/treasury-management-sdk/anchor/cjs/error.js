"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangErrorMessage = exports.LangErrorCode = exports.translateError = exports.ProgramError = exports.AnchorError = exports.ProgramErrorStack = exports.IdlError = void 0;
const web3_js_1 = require("@solana/web3.js");
const features = __importStar(require("./utils/features.js"));
class IdlError extends Error {
    constructor(message) {
        super(message);
        this.name = "IdlError";
    }
}
exports.IdlError = IdlError;
class ProgramErrorStack {
    constructor(stack) {
        this.stack = stack;
    }
    static parse(logs) {
        var _a;
        const programKeyRegex = /^Program (\w*) invoke/;
        const successRegex = /^Program \w* success/;
        const programStack = [];
        for (let i = 0; i < logs.length; i++) {
            if (successRegex.exec(logs[i])) {
                programStack.pop();
                continue;
            }
            const programKey = (_a = programKeyRegex.exec(logs[i])) === null || _a === void 0 ? void 0 : _a[1];
            if (!programKey) {
                continue;
            }
            programStack.push(new web3_js_1.PublicKey(programKey));
        }
        return new ProgramErrorStack(programStack);
    }
}
exports.ProgramErrorStack = ProgramErrorStack;
class AnchorError extends Error {
    constructor(errorCode, errorMessage, errorLogs, logs, origin, comparedValues) {
        super(errorLogs.join("\n").replace("Program log: ", ""));
        this.errorLogs = errorLogs;
        this.logs = logs;
        this.error = { errorCode, errorMessage, comparedValues, origin };
        this._programErrorStack = ProgramErrorStack.parse(logs);
    }
    static parse(logs) {
        if (!logs) {
            return null;
        }
        const anchorErrorLogIndex = logs.findIndex((log) => log.startsWith("Program log: AnchorError"));
        if (anchorErrorLogIndex === -1) {
            return null;
        }
        const anchorErrorLog = logs[anchorErrorLogIndex];
        const errorLogs = [anchorErrorLog];
        let comparedValues;
        if (anchorErrorLogIndex + 1 < logs.length) {
            // This catches the comparedValues where the following is logged
            // <AnchorError>
            // Left:
            // <Pubkey>
            // Right:
            // <Pubkey>
            if (logs[anchorErrorLogIndex + 1] === "Program log: Left:") {
                const pubkeyRegex = /^Program log: (.*)$/;
                const leftPubkey = pubkeyRegex.exec(logs[anchorErrorLogIndex + 2])[1];
                const rightPubkey = pubkeyRegex.exec(logs[anchorErrorLogIndex + 4])[1];
                comparedValues = [
                    new web3_js_1.PublicKey(leftPubkey),
                    new web3_js_1.PublicKey(rightPubkey),
                ];
                errorLogs.push(...logs.slice(anchorErrorLogIndex + 1, anchorErrorLogIndex + 5));
            }
            // This catches the comparedValues where the following is logged
            // <AnchorError>
            // Left: <value>
            // Right: <value>
            else if (logs[anchorErrorLogIndex + 1].startsWith("Program log: Left:")) {
                const valueRegex = /^Program log: (Left|Right): (.*)$/;
                const leftValue = valueRegex.exec(logs[anchorErrorLogIndex + 1])[2];
                const rightValue = valueRegex.exec(logs[anchorErrorLogIndex + 2])[2];
                errorLogs.push(...logs.slice(anchorErrorLogIndex + 1, anchorErrorLogIndex + 3));
                comparedValues = [leftValue, rightValue];
            }
        }
        const regexNoInfo = /^Program log: AnchorError occurred\. Error Code: (.*)\. Error Number: (\d*)\. Error Message: (.*)\./;
        const noInfoAnchorErrorLog = regexNoInfo.exec(anchorErrorLog);
        const regexFileLine = /^Program log: AnchorError thrown in (.*):(\d*)\. Error Code: (.*)\. Error Number: (\d*)\. Error Message: (.*)\./;
        const fileLineAnchorErrorLog = regexFileLine.exec(anchorErrorLog);
        const regexAccountName = /^Program log: AnchorError caused by account: (.*)\. Error Code: (.*)\. Error Number: (\d*)\. Error Message: (.*)\./;
        const accountNameAnchorErrorLog = regexAccountName.exec(anchorErrorLog);
        if (noInfoAnchorErrorLog) {
            const [errorCodeString, errorNumber, errorMessage] = noInfoAnchorErrorLog.slice(1, 4);
            const errorCode = {
                code: errorCodeString,
                number: parseInt(errorNumber),
            };
            return new AnchorError(errorCode, errorMessage, errorLogs, logs, undefined, comparedValues);
        }
        else if (fileLineAnchorErrorLog) {
            const [file, line, errorCodeString, errorNumber, errorMessage] = fileLineAnchorErrorLog.slice(1, 6);
            const errorCode = {
                code: errorCodeString,
                number: parseInt(errorNumber),
            };
            const fileLine = { file, line: parseInt(line) };
            return new AnchorError(errorCode, errorMessage, errorLogs, logs, fileLine, comparedValues);
        }
        else if (accountNameAnchorErrorLog) {
            const [accountName, errorCodeString, errorNumber, errorMessage] = accountNameAnchorErrorLog.slice(1, 5);
            const origin = accountName;
            const errorCode = {
                code: errorCodeString,
                number: parseInt(errorNumber),
            };
            return new AnchorError(errorCode, errorMessage, errorLogs, logs, origin, comparedValues);
        }
        else {
            return null;
        }
    }
    get program() {
        return this._programErrorStack.stack[this._programErrorStack.stack.length - 1];
    }
    get programErrorStack() {
        return this._programErrorStack.stack;
    }
    toString() {
        return this.message;
    }
}
exports.AnchorError = AnchorError;
// An error from a user defined program.
class ProgramError extends Error {
    constructor(code, msg, logs) {
        super();
        this.code = code;
        this.msg = msg;
        this.logs = logs;
        if (logs) {
            this._programErrorStack = ProgramErrorStack.parse(logs);
        }
    }
    static parse(err, idlErrors) {
        const errString = err.toString();
        // TODO: don't rely on the error string. web3.js should preserve the error
        //       code information instead of giving us an untyped string.
        let unparsedErrorCode;
        if (errString.includes("custom program error:")) {
            let components = errString.split("custom program error: ");
            if (components.length !== 2) {
                return null;
            }
            else {
                unparsedErrorCode = components[1];
            }
        }
        else {
            const matches = errString.match(/"Custom":([0-9]+)}/g);
            if (!matches || matches.length > 1) {
                return null;
            }
            unparsedErrorCode = matches[0].match(/([0-9]+)/g)[0];
        }
        let errorCode;
        try {
            errorCode = parseInt(unparsedErrorCode);
        }
        catch (parseErr) {
            return null;
        }
        // Parse user error.
        let errorMsg = idlErrors.get(errorCode);
        if (errorMsg !== undefined) {
            return new ProgramError(errorCode, errorMsg, err.logs);
        }
        // Parse framework internal error.
        errorMsg = exports.LangErrorMessage.get(errorCode);
        if (errorMsg !== undefined) {
            return new ProgramError(errorCode, errorMsg, err.logs);
        }
        // Unable to parse the error. Just return the untranslated error.
        return null;
    }
    get program() {
        var _a;
        return (_a = this._programErrorStack) === null || _a === void 0 ? void 0 : _a.stack[this._programErrorStack.stack.length - 1];
    }
    get programErrorStack() {
        var _a;
        return (_a = this._programErrorStack) === null || _a === void 0 ? void 0 : _a.stack;
    }
    toString() {
        return this.msg;
    }
}
exports.ProgramError = ProgramError;
function translateError(err, idlErrors) {
    if (features.isSet("debug-logs")) {
        console.log("Translating error:", err);
    }
    const anchorError = AnchorError.parse(err.logs);
    if (anchorError) {
        return anchorError;
    }
    const programError = ProgramError.parse(err, idlErrors);
    if (programError) {
        return programError;
    }
    if (err.logs) {
        const handler = {
            get: function (target, prop) {
                if (prop === "programErrorStack") {
                    return target.programErrorStack.stack;
                }
                else if (prop === "program") {
                    return target.programErrorStack.stack[err.programErrorStack.stack.length - 1];
                }
                else {
                    // this is the normal way to return all other props
                    // without modifying them.
                    // @ts-expect-error
                    return Reflect.get(...arguments);
                }
            },
        };
        err.programErrorStack = ProgramErrorStack.parse(err.logs);
        return new Proxy(err, handler);
    }
    return err;
}
exports.translateError = translateError;
exports.LangErrorCode = {
    // Instructions.
    InstructionMissing: 100,
    InstructionFallbackNotFound: 101,
    InstructionDidNotDeserialize: 102,
    InstructionDidNotSerialize: 103,
    // IDL instructions.
    IdlInstructionStub: 1000,
    IdlInstructionInvalidProgram: 1001,
    // Constraints.
    ConstraintMut: 2000,
    ConstraintHasOne: 2001,
    ConstraintSigner: 2002,
    ConstraintRaw: 2003,
    ConstraintOwner: 2004,
    ConstraintRentExempt: 2005,
    ConstraintSeeds: 2006,
    ConstraintExecutable: 2007,
    ConstraintState: 2008,
    ConstraintAssociated: 2009,
    ConstraintAssociatedInit: 2010,
    ConstraintClose: 2011,
    ConstraintAddress: 2012,
    ConstraintZero: 2013,
    ConstraintTokenMint: 2014,
    ConstraintTokenOwner: 2015,
    ConstraintMintMintAuthority: 2016,
    ConstraintMintFreezeAuthority: 2017,
    ConstraintMintDecimals: 2018,
    ConstraintSpace: 2019,
    // Require.
    RequireViolated: 2500,
    RequireEqViolated: 2501,
    RequireKeysEqViolated: 2502,
    RequireNeqViolated: 2503,
    RequireKeysNeqViolated: 2504,
    RequireGtViolated: 2505,
    RequireGteViolated: 2506,
    // Accounts.
    AccountDiscriminatorAlreadySet: 3000,
    AccountDiscriminatorNotFound: 3001,
    AccountDiscriminatorMismatch: 3002,
    AccountDidNotDeserialize: 3003,
    AccountDidNotSerialize: 3004,
    AccountNotEnoughKeys: 3005,
    AccountNotMutable: 3006,
    AccountOwnedByWrongProgram: 3007,
    InvalidProgramId: 3008,
    InvalidProgramExecutable: 3009,
    AccountNotSigner: 3010,
    AccountNotSystemOwned: 3011,
    AccountNotInitialized: 3012,
    AccountNotProgramData: 3013,
    AccountNotAssociatedTokenAccount: 3014,
    AccountSysvarMismatch: 3015,
    AccountReallocExceedsLimit: 3016,
    AccountDuplicateReallocs: 3017,
    // State.
    StateInvalidAddress: 4000,
    // Miscellaneous
    DeclaredProgramIdMismatch: 4100,
    // Used for APIs that shouldn't be used anymore.
    Deprecated: 5000,
};
exports.LangErrorMessage = new Map([
    // Instructions.
    [
        exports.LangErrorCode.InstructionMissing,
        "8 byte instruction identifier not provided",
    ],
    [
        exports.LangErrorCode.InstructionFallbackNotFound,
        "Fallback functions are not supported",
    ],
    [
        exports.LangErrorCode.InstructionDidNotDeserialize,
        "The program could not deserialize the given instruction",
    ],
    [
        exports.LangErrorCode.InstructionDidNotSerialize,
        "The program could not serialize the given instruction",
    ],
    // Idl instructions.
    [
        exports.LangErrorCode.IdlInstructionStub,
        "The program was compiled without idl instructions",
    ],
    [
        exports.LangErrorCode.IdlInstructionInvalidProgram,
        "The transaction was given an invalid program for the IDL instruction",
    ],
    // Constraints.
    [exports.LangErrorCode.ConstraintMut, "A mut constraint was violated"],
    [exports.LangErrorCode.ConstraintHasOne, "A has_one constraint was violated"],
    [exports.LangErrorCode.ConstraintSigner, "A signer constraint was violated"],
    [exports.LangErrorCode.ConstraintRaw, "A raw constraint was violated"],
    [exports.LangErrorCode.ConstraintOwner, "An owner constraint was violated"],
    [
        exports.LangErrorCode.ConstraintRentExempt,
        "A rent exemption constraint was violated",
    ],
    [exports.LangErrorCode.ConstraintSeeds, "A seeds constraint was violated"],
    [exports.LangErrorCode.ConstraintExecutable, "An executable constraint was violated"],
    [exports.LangErrorCode.ConstraintState, "A state constraint was violated"],
    [exports.LangErrorCode.ConstraintAssociated, "An associated constraint was violated"],
    [
        exports.LangErrorCode.ConstraintAssociatedInit,
        "An associated init constraint was violated",
    ],
    [exports.LangErrorCode.ConstraintClose, "A close constraint was violated"],
    [exports.LangErrorCode.ConstraintAddress, "An address constraint was violated"],
    [exports.LangErrorCode.ConstraintZero, "Expected zero account discriminant"],
    [exports.LangErrorCode.ConstraintTokenMint, "A token mint constraint was violated"],
    [exports.LangErrorCode.ConstraintTokenOwner, "A token owner constraint was violated"],
    [
        exports.LangErrorCode.ConstraintMintMintAuthority,
        "A mint mint authority constraint was violated",
    ],
    [
        exports.LangErrorCode.ConstraintMintFreezeAuthority,
        "A mint freeze authority constraint was violated",
    ],
    [
        exports.LangErrorCode.ConstraintMintDecimals,
        "A mint decimals constraint was violated",
    ],
    [exports.LangErrorCode.ConstraintSpace, "A space constraint was violated"],
    // Require.
    [exports.LangErrorCode.RequireViolated, "A require expression was violated"],
    [exports.LangErrorCode.RequireEqViolated, "A require_eq expression was violated"],
    [
        exports.LangErrorCode.RequireKeysEqViolated,
        "A require_keys_eq expression was violated",
    ],
    [exports.LangErrorCode.RequireNeqViolated, "A require_neq expression was violated"],
    [
        exports.LangErrorCode.RequireKeysNeqViolated,
        "A require_keys_neq expression was violated",
    ],
    [exports.LangErrorCode.RequireGtViolated, "A require_gt expression was violated"],
    [exports.LangErrorCode.RequireGteViolated, "A require_gte expression was violated"],
    // Accounts.
    [
        exports.LangErrorCode.AccountDiscriminatorAlreadySet,
        "The account discriminator was already set on this account",
    ],
    [
        exports.LangErrorCode.AccountDiscriminatorNotFound,
        "No 8 byte discriminator was found on the account",
    ],
    [
        exports.LangErrorCode.AccountDiscriminatorMismatch,
        "8 byte discriminator did not match what was expected",
    ],
    [exports.LangErrorCode.AccountDidNotDeserialize, "Failed to deserialize the account"],
    [exports.LangErrorCode.AccountDidNotSerialize, "Failed to serialize the account"],
    [
        exports.LangErrorCode.AccountNotEnoughKeys,
        "Not enough account keys given to the instruction",
    ],
    [exports.LangErrorCode.AccountNotMutable, "The given account is not mutable"],
    [
        exports.LangErrorCode.AccountOwnedByWrongProgram,
        "The given account is owned by a different program than expected",
    ],
    [exports.LangErrorCode.InvalidProgramId, "Program ID was not as expected"],
    [exports.LangErrorCode.InvalidProgramExecutable, "Program account is not executable"],
    [exports.LangErrorCode.AccountNotSigner, "The given account did not sign"],
    [
        exports.LangErrorCode.AccountNotSystemOwned,
        "The given account is not owned by the system program",
    ],
    [
        exports.LangErrorCode.AccountNotInitialized,
        "The program expected this account to be already initialized",
    ],
    [
        exports.LangErrorCode.AccountNotProgramData,
        "The given account is not a program data account",
    ],
    [
        exports.LangErrorCode.AccountNotAssociatedTokenAccount,
        "The given account is not the associated token account",
    ],
    [
        exports.LangErrorCode.AccountSysvarMismatch,
        "The given public key does not match the required sysvar",
    ],
    [
        exports.LangErrorCode.AccountReallocExceedsLimit,
        "The account reallocation exceeds the MAX_PERMITTED_DATA_INCREASE limit",
    ],
    [
        exports.LangErrorCode.AccountDuplicateReallocs,
        "The account was duplicated for more than one reallocation",
    ],
    // State.
    [
        exports.LangErrorCode.StateInvalidAddress,
        "The given state account does not have the correct address",
    ],
    // Miscellaneous
    [
        exports.LangErrorCode.DeclaredProgramIdMismatch,
        "The declared program id does not match the actual program id",
    ],
    // Deprecated
    [
        exports.LangErrorCode.Deprecated,
        "The API being used is deprecated and should no longer be used",
    ],
]);
//# sourceMappingURL=error.js.map