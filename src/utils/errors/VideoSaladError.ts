import { BowlImportError } from './BowlError.js';

export interface ImportRejectedResult extends PromiseRejectedResult {
    reason: BowlImportError;
}

export enum VideoSaladType {
    MixingBowl = 'MixingBowl',
    IngredientBowl = 'IngredientBowl',
    ChaptersIngredient = 'ChaptersIngredient',
    StreamIngredient = 'StreamIngredient'
}

enum VideoSaladErrorName {
    VideoSaladImportBowlError = 'VideoSaladImportBowlError',
    VideoSaladNotFoundError = 'VideoSaladNotFoundError'
}

export abstract class VideoSaladError extends Error {
    constructor(public readonly errorName: VideoSaladErrorName, message: string) {
        super(message);
    }

    public static VideoSaladTypeToDisplayName(type: VideoSaladType) {
        switch (type) {
            case VideoSaladType.MixingBowl:
                return 'Mixing Bowl';
            case VideoSaladType.IngredientBowl:
                return 'Ingredient Bowl';
            case VideoSaladType.ChaptersIngredient:
                return 'Chapters Ingredient';
            case VideoSaladType.StreamIngredient:
                return 'Ingredient';
        }
    }
}


// VideoSalad could not import these files
export class VideoSaladImportBowlError extends VideoSaladError {
    constructor(public bowlImportErrors: BowlImportError[]) {

        super(
            VideoSaladErrorName.VideoSaladImportBowlError,
            `Failed to import Ingredient Bowls`
        );
    }
}


export class VideoSaladNotFoundError extends VideoSaladError {
    constructor(public type: VideoSaladType, public id: number) {
        super(
            VideoSaladErrorName.VideoSaladNotFoundError,
            `${VideoSaladError.VideoSaladTypeToDisplayName(type)} ${id} not found`
        );
    }
}
