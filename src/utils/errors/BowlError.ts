enum BowlErrorName {
    BowlAccessError = 'BowlAccessError',
    BowlFileTypeError = 'BowlFileTypeError',
    BowlFFProbeError = 'BowlFFProbeError',
    BowlMixError = 'BowlMixError',
    BowlMixNoOutputError = 'BowlMixNoOutputError',
    BowlMixNoIngredientsError = 'BowlMixNoIngredientsError',
    BowlMixInvalidOutputError = 'BowlMixInvalidOutputError'
}

export abstract class BowlError extends Error {
    constructor(public readonly errorName: BowlErrorName, message: string) {
        super(message);
    }
}

export abstract class BowlImportError extends BowlError {
    constructor(errorName: BowlErrorName, public filePath: string, message: string) {
        super(errorName, message);
    }
}

// VideoSalad has no access to this file
export class BowlAccessError extends BowlImportError {
    constructor(filePath: string) {

        super(BowlErrorName.BowlAccessError, filePath, `No access to file`);
    }
}

// filePath is not a valid file
export class BowlFileTypeError extends BowlImportError {
    constructor(filePath: string) {

        super(BowlErrorName.BowlFileTypeError, filePath, `Not a valid file`);
    }
}

// ffprobe error
export class BowlFFProbeError extends BowlImportError {
    constructor(filePath: string, public ffprobeError: unknown) {

        super(BowlErrorName.BowlFFProbeError, filePath, `Unknown ffprobe error`);
    }
}

export abstract class MixingBowlError extends BowlError {
    constructor(errorName: BowlErrorName, public id: number, message: string) {
        super(errorName, message);
    }
}

export abstract class BowlMixError extends MixingBowlError {

}

export class BowlMixNoOutputError extends BowlMixError {
    constructor(id: number) {
        super(BowlErrorName.BowlMixNoOutputError, id, `No output file path provided`);
    }
}

export class BowlMixNoIngredientsError extends BowlMixError {
    constructor(id: number) {
        super(BowlErrorName.BowlMixNoIngredientsError, id, `No ingredients provided`);
    }
}

export class BowlMixInvalidOutputError extends BowlMixError {
    constructor(id: number, public filePath: string, public ingredientIds: number[]) {
        super(
            BowlErrorName.BowlMixInvalidOutputError,
            id,
            `Output file path cannot be the same as any Ingredient`
        );
    }
}