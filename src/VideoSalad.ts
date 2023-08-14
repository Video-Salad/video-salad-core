import Ffmpeg from 'fluent-ffmpeg';
import { BaseMeta, NutritionLogger } from './utils/logging/NutritionLogger.js';
import { BowlTags, IngredientBowl, MixingBowl } from './Bowl.js';
import { ChaptersIngredient, StreamIngredient } from './Ingredient.js';
import { ImportRejectedResult, VideoSaladImportBowlError, VideoSaladNotFoundError, VideoSaladType } from './utils/errors/VideoSaladError.js';

interface Resolvable {
    mixingBowlId: number;
    mixingBowl: MixingBowl;
    ingredientBowlId: number;
    ingredientBowl: IngredientBowl;
    ingredientId: number;
    chaptersIngredientId: number;
    ingredient: StreamIngredient;
    ingredientIds: number[];
    ingredients: StreamIngredient[];
    chaptersIngredient: ChaptersIngredient;
}

export interface UpdatableMixingBowl extends Partial<Pick<MixingBowl, 'output' | 'tags'>> {
    ingredientIds?: number[];
    chaptersIngredientId?: number;
}

// Utility type to extract the fluent-ffmpeg available capabilities return values from a callback
type SecondCallbackArg<F> = F extends (callback: (error: infer E, value: infer V) => void) => void ? V : never;

export type UpdatableIngredient = Partial<Pick<StreamIngredient, 'tags' | 'dispositions'>>;

// https://stackoverflow.com/questions/40510611/typescript-interface-require-one-of-two-properties-to-exist
type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>>
    & { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

export class VideoSalad {
    private nextCommandId = 0;

    // FFMPEG Capabilities
    private capabilities?: {
        formats?: SecondCallbackArg<typeof Ffmpeg.availableFormats>;
        codecs?: SecondCallbackArg<typeof Ffmpeg.availableCodecs>;
        encoders?: SecondCallbackArg<typeof Ffmpeg.availableEncoders>;
        filters?: SecondCallbackArg<typeof Ffmpeg.availableFilters>;
    };

    private mixingBowlMap: { [bowlId: number]: { removed: boolean; bowl: MixingBowl } } = {};
    private ingredientBowlMap: { [bowlId: number]: { removed: boolean; bowl: IngredientBowl } } = {};

    public logger = NutritionLogger.instance.logger;

    constructor(ffmpegPath?: string, ffprobePath?: string) {
        NutritionLogger.Info(
            'Initialize FFMPEG',
            {
                location: 'VideoSalad',
                functionName: 'constructor',
                operation: 'Set FFMPEG paths',
                ffmpegPath,
                ffprobePath
            }
        );
        // Set ffmpeg and ffprobe paths and initialize ffmpeg and ffprobe
        if (ffmpegPath) {
            Ffmpeg.setFfmpegPath(ffmpegPath);
        }
        if (ffprobePath) {
            Ffmpeg.setFfprobePath(ffprobePath);
        }
    }

    //#region Public SDK API

    public get FFMPEGCapabilities() {
        // Return cached capabilities
        if (this.capabilities) {
            return this.capabilities;
        }

        const baseMeta: BaseMeta = {
            location: 'VideoSalad',
            functionName: 'FFMPEGCapabilities',
            operation: 'Get FFMPEG Capabilities'
        };
        NutritionLogger.Debug(
            'Get FFMPEG Capabilities',
            baseMeta
        );

        // Warning: Callback Hell
        Ffmpeg.availableFormats((formatErr, formatsResult) => {
            if (formatErr) {
                NutritionLogger.Error(
                    'Get FFMPEG Capabilities - Available Formats',
                    {
                        ...baseMeta,
                        operation: 'Get FFMPEG Capabilities - Available Formats',
                        error: formatErr
                    }
                );
                return;
            }
            if (!this.capabilities) {
                this.capabilities = {};
            }
            this.capabilities.formats = formatsResult;
        });
        Ffmpeg.availableCodecs((codecErr, codecsResult) => {
            if (codecErr) {
                NutritionLogger.Error(
                    'Get FFMPEG Capabilities - Available Codecs',
                    {
                        ...baseMeta,
                        operation: 'Get FFMPEG Capabilities - Available Codecs',
                        error: codecErr
                    }
                );
                return;
            }
            if (!this.capabilities) {
                this.capabilities = {};
            }
            this.capabilities.codecs = codecsResult;
        });
        Ffmpeg.availableEncoders((encoderErr, encodersResult) => {
            if (encoderErr) {
                NutritionLogger.Error(
                    'Get FFMPEG Capabilities - Available Encoders',
                    {
                        ...baseMeta,
                        operation: 'Get FFMPEG Capabilities - Available Encoders',
                        error: encoderErr
                    }
                );
                return;
            }
            if (!this.capabilities) {
                this.capabilities = {};
            }
            this.capabilities.encoders = encodersResult;
        });
        Ffmpeg.availableFilters((filterErr, filtersResult) => {
            if (filterErr) {
                NutritionLogger.Error(
                    'Get FFMPEG Capabilities - Available Filters',
                    {
                        ...baseMeta,
                        operation: 'Get FFMPEG Capabilities - Available Filters',
                        error: filterErr
                    }
                );
                return;
            }
            if (!this.capabilities) {
                this.capabilities = {};
            }
            this.capabilities.filters = filtersResult;
        });

        return this.capabilities;
    }

    public get mixingBowls() {
        return Object.values(this.mixingBowlMap)
            .filter(({ removed }) => !removed)
            .map(({ bowl }) => bowl);
    }

    public get ingredientBowls() {
        return Object.values(this.ingredientBowlMap)
            .filter(({ removed }) => !removed)
            .map(({ bowl }) => bowl);
    }

    public get ingredients() {
        return this.ingredientBowls
            .map(bowl => bowl.ingredients)
            .flat();
    }

    public getMixingBowl(bowlId: number) {
        NutritionLogger.Debug(
            'Get Mixing Bowl',
            {
                location: 'VideoSalad',
                functionName: 'getMixingBowl',
                operation: 'Get Mixing Bowl',
                bowlId
            }
        );

        const { removed, bowl } = this.getAnyMixingBowl(bowlId);
        if (removed) {
            const error = new VideoSaladNotFoundError(VideoSaladType.MixingBowl, bowlId);
            NutritionLogger.Error(
                'Mixing Bowl not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getMixingBowl',
                    operation: 'Get Mixing Bowl',
                    bowlId,
                    error
                }
            );
            throw error;
        }
        return bowl;
    }

    public getIngredientBowl(bowlId: number) {
        NutritionLogger.Debug(
            'Get Ingredient Bowl',
            {
                location: 'VideoSalad',
                functionName: 'getIngredientBowl',
                operation: 'Get Ingredient Bowl',
                bowlId
            }
        );

        const { removed, bowl } = this.getAnyIngredientBowl(bowlId);
        if (removed) {
            const error = new VideoSaladNotFoundError(VideoSaladType.IngredientBowl, bowlId);
            NutritionLogger.Error(
                'Ingredient Bowl not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getIngredientBowl',
                    operation: 'Get Ingredient Bowl',
                    bowlId,
                    error
                }
            );
            throw error;
        }
        return bowl;
    }

    private getAnyMixingBowl(bowlId: number) {
        NutritionLogger.Debug(
            'Get Any Mixing Bowl',
            {
                location: 'VideoSalad',
                functionName: 'getAnyMixingBowl',
                operation: 'Get Any Mixing Bowl',
                bowlId
            }
        );

        const bowl = this.mixingBowlMap[bowlId];
        if (!bowl) {
            const error = new VideoSaladNotFoundError(VideoSaladType.MixingBowl, bowlId);
            NutritionLogger.Error(
                'Mixing Bowl not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getAnyMixingBowl',
                    operation: 'Get Any Mixing Bowl',
                    bowlId,
                    error
                }
            );
            throw error;
        }
        return bowl;
    }

    private getAnyIngredientBowl(bowlId: number) {
        NutritionLogger.Debug(
            'Get Any Ingredient Bowl',
            {
                location: 'VideoSalad',
                functionName: 'getAnyIngredientBowl',
                operation: 'Get Any Ingredient Bowl',
                bowlId
            }
        );

        const ingredientBowl = this.ingredientBowlMap[bowlId];
        if (!ingredientBowl) {
            const error = new VideoSaladNotFoundError(VideoSaladType.IngredientBowl, bowlId);
            NutritionLogger.Error(
                'Ingredient Bowl not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getAnyIngredientBowl',
                    operation: 'Get Any Ingredient Bowl',
                    error
                }
            );
            throw error;
        }
        return ingredientBowl;
    }

    private getIngredient(ingredientId: number) {
        NutritionLogger.Debug(
            'Get Ingredient',
            {
                location: 'VideoSalad',
                functionName: 'getIngredient',
                operation: 'Get Ingredient',
                ingredientId
            }
        );

        const ingredient = this.ingredients.find(streamIngredient => streamIngredient.id === ingredientId);
        if (!ingredient) {
            const error = new VideoSaladNotFoundError(VideoSaladType.StreamIngredient, ingredientId);
            NutritionLogger.Error(
                'Ingredient not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getIngredient',
                    operation: 'Get Ingredient',
                    ingredientId,
                    error
                }
            );
            throw error;
        }
        return ingredient;
    }

    private getChaptersIngredient(chaptersIngredientId: number) {
        NutritionLogger.Debug(
            'Get Chapters Ingredient',
            {
                location: 'VideoSalad',
                functionName: 'getChaptersIngredient',
                operation: 'Get Chapters Ingredient',
                chaptersIngredientId
            }
        );

        const chaptersIngredient = this.ingredientBowls.find(bowl => bowl.chapters?.id === chaptersIngredientId)?.chapters;
        if (!chaptersIngredient) {
            const error = new VideoSaladNotFoundError(VideoSaladType.ChaptersIngredient, chaptersIngredientId);
            NutritionLogger.Error(
                'Chapters Ingredient not found',
                {
                    location: 'VideoSalad',
                    functionName: 'getChaptersIngredient',
                    operation: 'Get Chapters Ingredient',
                    chaptersIngredientId,
                    error
                }
            );
            throw error;
        }
        return chaptersIngredient;
    }

    public async importBowls(filePaths: string[]) {
        return this.importIngredientBowls(filePaths, this.newCommandId);
    }

    public async removeImportedBowl(ingredientBowlId: number) {
        const { ingredientBowl } = this.resolveItems({ ingredientBowlId });
        return this.removeIngredientBowl(ingredientBowl, this.newCommandId);
    }

    public async createBowls(outputFilePaths: string[]) {
        return this.createMixingBowls(outputFilePaths, this.newCommandId);
    }

    public async updateBowl(bowlId: number, updates: UpdatableMixingBowl) {
        const {
            mixingBowl,
            ingredients,
            chaptersIngredient
        } = this.resolveItems({
            mixingBowlId: bowlId,
            ingredientIds: updates.ingredientIds,
            chaptersIngredientId: updates.chaptersIngredientId
        });
        return this.updateMixingBowl(
            mixingBowl,
            {
                output: updates.output,
                tags: updates.tags,
                ingredients,
                chapters: chaptersIngredient
            },
            this.newCommandId
        );
    }

    public async removeBowl(bowlId: number) {
        return this.removeMixingBowl(bowlId, this.newCommandId);
    }

    public async addIngredientToBowl(bowlId: number, ingredientId: number) {
        const { mixingBowl, ingredient } = this.resolveItems({ mixingBowlId: bowlId, ingredientId });
        return this.addIngredient(mixingBowl, ingredient, this.newCommandId);
    }

    public async removeIngredientFromBowl(bowlId: number, ingredientId: number) {
        const { mixingBowl, ingredient } = this.resolveItems({ mixingBowlId: bowlId, ingredientId });
        return this.removeIngredient(mixingBowl, ingredient, this.newCommandId);
    }

    // public async mixBowl(bowlId: number) {
    //     const { mixingBowl } = this.resolveItems({ mixingBowlId: bowlId });
    //     return this.mixMixingBowl(mixingBowl, this.newCommandId);
    // }

    public async updateIngredient(ingredientId: number, updates: Partial<Pick<StreamIngredient, 'tags' | 'dispositions'>>) {
        const { ingredient } = this.resolveItems({ ingredientId });
        return this.updateIngredientBowlIngredient(ingredient, updates, this.newCommandId);
    }

    public async copyIngredient(ingredientId: number) {
        const { ingredient } = this.resolveItems({ ingredientId });
        return this.copyIngredientBowlIngredient(ingredient, this.newCommandId);
    }

    //#endregion Public SDK API

    //#region Utilities

    private get newCommandId() {
        return this.nextCommandId++;
    }

    private resolveItems(ids: RequireAtLeastOne<Pick<Resolvable, 'mixingBowlId' | 'ingredientBowlId' | 'ingredientId' | 'ingredientIds' | 'chaptersIngredientId'>>) {
        const resolved = {} as Pick<Resolvable, 'mixingBowl' | 'ingredientBowl' | 'ingredient' | 'ingredients' | 'chaptersIngredient'>;

        if (!Object.keys(ids).length) {
            throw new Error('At least one of mixingBowlId, ingredientBowlId, ingredientId, ingredientIds, or chaptersIngredientId must be specified');
        }

        if (ids.mixingBowlId !== undefined) {
            resolved.mixingBowl = this.getMixingBowl(ids.mixingBowlId);
        }
        if (ids.ingredientBowlId !== undefined) {
            resolved.ingredientBowl = this.getIngredientBowl(ids.ingredientBowlId);
        }
        if (ids.ingredientId !== undefined) {
            resolved.ingredient = this.getIngredient(ids.ingredientId);
        }
        if (ids.ingredientIds !== undefined && Array.isArray(ids.ingredientIds) && ids.ingredientIds.length > 0) {
            resolved.ingredients = ids.ingredientIds.map(id => this.getIngredient(id));
        }
        if (ids.chaptersIngredientId !== undefined) {
            resolved.chaptersIngredient = this.getChaptersIngredient(ids.chaptersIngredientId);
        }

        return resolved;
    }

    //#endregion Utilities

    //#region Implementations

    private async importIngredientBowls(filePaths: string[], commandId: number) {
        const baseMeta: BaseMeta = {
            location: 'VideoSalad',
            functionName: 'importIngredientBowls',
            operation: 'Import Ingredient Bowls',
        };
        NutritionLogger.Debug(
            'Import Ingredient Bowls',
            {
                ...baseMeta,
                commandId,
                // filePaths
            }
        );

        const initResults = await Promise.allSettled(filePaths.map(IngredientBowl.Initialize));

        if (initResults.some(result => result.status === 'rejected')) {
            const initErrors = initResults
                .filter(<(T: PromiseSettledResult<IngredientBowl>) => T is ImportRejectedResult>((result) => result.status === 'rejected'))
                .map(result => result.reason);
            const videoSaladError = new VideoSaladImportBowlError(initErrors);

            NutritionLogger.Error(
                'Import Ingredient Bowls',
                {
                    ...baseMeta,
                    commandId,
                    filePaths,
                    error: videoSaladError
                }
            );

            return Promise.reject(videoSaladError);
        }

        const ingredientBowls = (initResults as PromiseFulfilledResult<IngredientBowl>[])
            .map(result => result.value);

        ingredientBowls.forEach((bowl) => {
            this.ingredientBowlMap[bowl.id] = {
                removed: false,
                bowl: bowl
            };
        });

        return ingredientBowls;
    }

    private async removeIngredientBowl(ingredientBowl: IngredientBowl, commandId: number) {
        const baseMeta: BaseMeta = {
            location: 'VideoSalad',
            functionName: 'removeIngredientBowl',
            operation: 'Remove Ingredient Bowl'
        };
        NutritionLogger.Debug(
            'Remove Ingredient Bowl',
            {
                ...baseMeta,
                commandId,
                ingredientBowlId: ingredientBowl.id
            }
        );

        // Get all mixingBowls that share the same ingredients as the ingredientBowl
        const affectedMixingBowls = Object.values(this.mixingBowlMap).reduce((acc, { bowl }) => {
            acc[bowl.id] = bowl.ingredients.filter(ingredient => {
                return ingredientBowl.ingredients
                    .map(bowlIngredient => bowlIngredient.id)
                    .some(bowlIngredient => bowlIngredient === ingredient.id);
            });
            return acc;
        }, {} as { [bowlId: number]: StreamIngredient[] });

        NutritionLogger.Debug(
            'Remove Ingredient Bowl',
            {
                ...baseMeta,
                commandId,
                ingredientBowlId: ingredientBowl.id,
                subOperations: ['Get affectedMixingBowls'],
                affectedMixingBowlIds: Object.keys(affectedMixingBowls)
            }
        );

        Object.entries(affectedMixingBowls).forEach(([bowlId, ingredients]) => {
            const { bowl } = this.mixingBowlMap[Number(bowlId)];
            ingredients.forEach(ingredient => {
                bowl.removeIngredient(ingredient);
            });
        });
    }

    private async createMixingBowls(filePaths: string[], commandId: number) {
        NutritionLogger.Debug(
            'Create Mixing Bowls',
            {
                location: 'VideoSalad',
                functionName: 'createMixingBowls',
                operation: 'Create Mixing Bowls',
                commandId
            }
        );

        const bowls = filePaths.map(filePath => new MixingBowl(filePath));
        bowls.forEach(bowl => {
            this.mixingBowlMap[bowl.id] = {
                removed: false,
                bowl
            };
        });

        return bowls;
    }

    private async updateMixingBowl(mixingBowl: MixingBowl, updates: Partial<Pick<MixingBowl, 'output' | 'tags' | 'ingredients' | 'chapters'>>, commandId: number) {
        NutritionLogger.Debug(
            'Update Mixing Bowl',
            {
                location: 'VideoSalad',
                functionName: 'updateMixingBowl',
                operation: 'Update Mixing Bowl',
                commandId,
                mixingBowlId: mixingBowl.id,
                updates: {
                    ...(updates.output ? { output: updates.output } : {}),
                    ...(updates.tags ? { tags: updates.tags } : {}),
                    ...(updates.chapters ? { chapters: updates.chapters.id } : {}),
                    ...(updates.ingredients ? { ingredients: updates.ingredients.map(ingredient => ingredient.id) } : {})
                }
            }
        );

        if (updates.output) {
            this.updateMixingBowlOutput(mixingBowl, updates.output, commandId);
        }
        if (updates.tags) {
            this.updateMixingBowlTags(mixingBowl, updates.tags, commandId);
        }
        if (updates.ingredients) {
            // Remove ingredients that are missing from updates.ingredients
            mixingBowl.ingredients
                .filter(ingredient => !updates.ingredients?.some(newIngredient => ingredient.id === newIngredient.id))
                .forEach((ingredient) => {
                    this.removeIngredient(mixingBowl, ingredient, commandId);
                });
            // Add new ingredients included in updates.ingredients
            updates.ingredients
                .filter(newIngredient => !mixingBowl.ingredients.some(ingredient => ingredient.id === newIngredient.id))
                .forEach((ingredient) => {
                    this.addIngredient(mixingBowl, ingredient, commandId);
                });
        }
        if (updates.chapters) {
            this.updateMixingBowlChapters(mixingBowl, updates.chapters, commandId);
        }

        return mixingBowl;
    }

    private async removeMixingBowl(bowlId: number, commandId: number) {
        NutritionLogger.Debug(
            'Remove Mixing Bowl',
            {
                location: 'VideoSalad',
                functionName: 'removeMixingBowl',
                operation: 'Remove Mixing Bowl',
                commandId,
                bowlId
            }
        );

        const bowl = this.getAnyMixingBowl(bowlId);

        // Cancel mixing before removing bowl
        if (bowl.bowl.status.state === 'mixing' || bowl.bowl.status.state === 'paused') {
            bowl.bowl.cancelMixing();
        }

        bowl.removed = true;
    }

    private async addIngredient(mixingBowl: MixingBowl, ingredient: StreamIngredient, commandId: number) {
        NutritionLogger.Debug(
            'Add Ingredient',
            {
                location: 'VideoSalad',
                functionName: 'addIngredient',
                operation: 'Add Ingredient',
                commandId,
                mixingBowlId: mixingBowl.id,
                ingredientId: ingredient.id
            }
        );

        mixingBowl.addIngredient(ingredient);
    }

    private async removeIngredient(mixingBowl: MixingBowl, ingredient: StreamIngredient, commandId: number) {
        NutritionLogger.Debug(
            'Remove Ingredient',
            {
                location: 'VideoSalad',
                functionName: 'removeIngredient',
                operation: 'Remove Ingredient',
                commandId,
                mixingBowlId: mixingBowl.id,
                ingredientId: ingredient.id
            }
        );

        mixingBowl.removeIngredient(ingredient);
    }

    private async updateMixingBowlOutput(mixingBowl: MixingBowl, output: string, commandId: number) {
        NutritionLogger.Debug(
            'Update Mixing Bowl Output',
            {
                location: 'VideoSalad',
                functionName: 'updateMixingBowlOutput',
                operation: 'Update Mixing Bowl Output',
                commandId,
                bowlId: mixingBowl.id,
                // output
            }
        );

        mixingBowl.output = output;

        return mixingBowl;
    }

    private async updateMixingBowlTags(mixingBowl: MixingBowl, tags: BowlTags, commandId: number) {
        NutritionLogger.Debug(
            'Update Mixing Bowl Tags',
            {
                location: 'VideoSalad',
                functionName: 'updateMixingBowlTags',
                operation: 'Update Mixing Bowl Tags',
                commandId,
                bowlId: mixingBowl.id,
                tags
            }
        );

        mixingBowl.tags = tags;

        return mixingBowl;
    }

    private async updateMixingBowlChapters(mixingBowl: MixingBowl, chapters: ChaptersIngredient, commandId: number) {
        NutritionLogger.Debug(
            'Update Mixing Bowl Chapters',
            {
                location: 'VideoSalad',
                functionName: 'updateMixingBowlChapters',
                operation: 'Update Mixing Bowl Chapters',
                commandId,
                bowlId: mixingBowl.id,
                chaptersIngredientId: chapters.id
            }
        );

        mixingBowl.chapters = chapters;

        return mixingBowl;
    }

    private async updateIngredientBowlIngredient(ingredient: StreamIngredient, updates: Partial<Pick<StreamIngredient, 'tags' | 'dispositions'>>, commandId: number) {
        NutritionLogger.Debug(
            'Update Ingredient Bowl Ingredient',
            {
                location: 'VideoSalad',
                functionName: 'updateIngredientBowlIngredient',
                operation: 'Update Ingredient Bowl Ingredient',
                commandId,
                ingredientId: ingredient.id,
                updates
            }
        );

        if (updates.tags) {
            ingredient.tags = updates.tags;
        }
        if (updates.dispositions) {
            ingredient.dispositions = updates.dispositions;
        }

        return ingredient;
    }

    private async copyIngredientBowlIngredient(ingredient: StreamIngredient, commandId: number) {
        const baseMeta: BaseMeta = {
            location: 'VideoSalad',
            functionName: 'copyIngredientBowlIngredient',
            operation: 'Copy Ingredient Bowl Ingredient'
        };
        NutritionLogger.Debug(
            'Copy Ingredient Bowl Ingredient',
            {
                ...baseMeta,
                commandId,
                ingredientId: ingredient.id
            }
        );

        // Find IngredientBowl containing the ingredient
        const ingredientBowl = this.ingredientBowls.find(bowl => bowl.ingredients.find(streamIngredient => streamIngredient.id === ingredient.id));
        if (!ingredientBowl) {
            // This should not occur
            const error = new Error(`Could not find ingredientBowl containing ingredient ${ingredient.id}`);
            NutritionLogger.Error(
                'Ingredient Bowl not found',
                {
                    ...baseMeta,
                    commandId,
                    ingredientId: ingredient.id,
                    subOperations: ['Get Ingredient Bowl'],
                    error
                }
            );

            throw error;
        }

        const copiedIngredient = ingredient.copy();
        ingredientBowl.addCopiedIngredient(copiedIngredient);

        return copiedIngredient;
    }

    //#endregion Implementations
}