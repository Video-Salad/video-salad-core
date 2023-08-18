import Ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

import {
    AttachmentIngredient,
    AudioIngredient,
    ChaptersIngredientChapter,
    ChaptersIngredient,
    DataIngredient,
    StreamIngredient,
    StreamIngredientType,
    SubtitleIngredient,
    Tags,
    VideoIngredient
} from './Ingredient.js';
import {
    BowlAccessError,
    BowlFFProbeError,
    BowlFileTypeError,
    BowlMixInvalidOutputError,
    BowlMixNoIngredientsError,
    BowlMixNoOutputError
} from './utils/errors/BowlError.js';
import {
    BaseMeta,
    NutritionLogger
} from './utils/logging/NutritionLogger.js';

// https://www.npmjs.com/package/fluent-ffmpeg#progress-transcoding-progress-information
export interface FfmpegProgress {
    frames: number; // total processed frame count
    currentFps: number; // framerate at which FFmpeg is currently processing
    currentKbps: number; // throughput at which FFmpeg is currently processing
    targetSize: number; // current size of the target file in kilobytes
    timemark: string; // the timestamp of the current frame in seconds
    percent: number; //an estimation of the progress percentage
}

// TODO: Determine types
// https://www.npmjs.com/package/fluent-ffmpeg#codecdata-input-codec-data-available
export interface FfmpegCodecData {
    format: string; // input format
    duration: string; // input duration
    audio: string; // audio codec
    audio_details: string; // audio encoding details
    video: string; // video codec
    video_details: string; // video encoding details
}

export interface MixingBowlStatus {
    time: Date;
    state: 'idle' | 'paused' | 'mixing' | 'done' | 'canceled' | 'error';
    fullFfmpegCommand?: string;
    codecData?: FfmpegCodecData;
    progress?: FfmpegProgress;
    error?: unknown;
}

// https://wiki.multimedia.cx/index.php/FFmpeg_Metadata
export type BowlTags = MatroskaTags | QuicktimeTags;

export interface MatroskaTags {
    [name: string]: string | undefined;
    title?: string;
    description?: string;
    language?: string;
}

export interface QuicktimeTags {
    title?: string;
    author?: string;
    album_artist?: string;
    album?: string;
    grouping?: string;
    composer?: string;
    year?: string;
    track?: string;
    comment?: string;
    genre?: string;
    copyright?: string;
    description?: string;
    synopsis?: string;
    show?: string;
    episode_id?: string;
    network?: string;
    lyrics?: string;
}

// const SUPPORTED_FORMATS: {
//     [format: string]: {
//         name: string;
//         longName: string;
//         ffmpegName: string;
//         ffmpegLongName: string;
//     }
// } = {
//     // mp4: 'MPEG-4', // TODO:
//     // mov: 'MOV', // TODO:
//     // avi: 'Audio Video Interleaved', // TODO: Selectively enable tracks
//     webm: {
//         name: 'webm',
//         longName: 'WebM',
//         ffmpegName: 'matroska,webm',
//         ffmpegLongName: 'Matroska / WebM'
//     },
//     mkv: {
//         name: 'mkv',
//         longName: 'Matroska',
//         ffmpegName: 'matroska,webm',
//         ffmpegLongName: 'Matroska / WebM'
//     }
// };

export class Bowl<TagType extends BowlTags = BowlTags> {
    // If necessary, Ids can be changed to the uuid library instead of sequential
    private static NEXT_ID = 0;

    public readonly id: number;

    protected readonly allIngredients: StreamIngredient[] = [];
    protected metadata?: TagType;
    private chaptersIngredient?: ChaptersIngredient;

    constructor(protected filePath: string) {
        // Set the id of the Bowl and increment the next id
        this.id = Bowl.NEXT_ID++;

        NutritionLogger.Debug(
            'Create new Bowl',
            {
                location: 'Bowl',
                functionName: 'constructor',
                operation: 'Create new Bowl',
                id: this.id
            }
        );
    }

    public get path() {
        return this.filePath;
    }

    public get fileName() {
        return path.basename(this.filePath);
    }

    public get ingredients() {
        return this.allIngredients;
    }

    public get videoIngredients() {
        return this.ingredients.filter((ingredient) => ingredient instanceof VideoIngredient) as VideoIngredient[];
    }

    public get audioIngredients() {
        return this.ingredients.filter((ingredient) => ingredient instanceof AudioIngredient) as AudioIngredient[];
    }

    public get subtitleIngredients() {
        return this.ingredients.filter((ingredient) => ingredient instanceof SubtitleIngredient) as SubtitleIngredient[];
    }

    public get attachmentIngredients() {
        return this.ingredients.filter((ingredient) => ingredient instanceof AttachmentIngredient) as AttachmentIngredient[];
    }

    public get dataIngredients() {
        return this.ingredients.filter((ingredient) => ingredient instanceof DataIngredient) as DataIngredient[];
    }

    public get chapters() {
        return this.chaptersIngredient;
    }

    public set chapters(chaptersIngredient: ChaptersIngredient | undefined) {
        this.chaptersIngredient = chaptersIngredient;
    }

    public get tags() {
        return this.metadata;
    }
}

export class IngredientBowl extends Bowl {
    private constructor(inputFilePath: string, public readonly ffProbeData: Ffmpeg.FfprobeData, ingredients: StreamIngredient[], chaptersIngredient?: ChaptersIngredient) {
        super(inputFilePath);

        this.ingredients.push(...ingredients);
        this.chapters = chaptersIngredient;
        this.metadata = this.ffProbeData.format.tags;
    }

    public static async Initialize(inputFilePath: string) {
        const baseMeta: BaseMeta = {
            location: 'IngredientBowl',
            functionName: 'Initialize',
            operation: 'Initialize new IngredientBowl'
        };
        NutritionLogger.Debug(
            'Initialize new IngredientBowl',
            {
                ...baseMeta,
            }
        );

        // Ensure the video file exists and read permissions
        try {
            await fs.promises.access(inputFilePath, fs.constants.R_OK);
        } catch (err) {
            const bowlError = new BowlAccessError(inputFilePath);
            NutritionLogger.Error(
                'Initialize new IngredientBowl',
                {
                    ...baseMeta,
                    subOperations: ['Check file access'],
                    path: inputFilePath,
                    error: bowlError
                }
            );

            return Promise.reject(bowlError);
        }

        const fileStat = await fs.promises.stat(inputFilePath);
        if (!fileStat.isFile()) {
            const bowlError = new BowlFileTypeError(inputFilePath);
            NutritionLogger.Error(
                'Initialize new IngredientBowl',
                {
                    ...baseMeta,
                    subOperations: ['Check if valid file'],
                    error: bowlError,
                    path: inputFilePath,
                    fileStat
                }
            );

            return Promise.reject(bowlError);
        }

        return new Promise<IngredientBowl>((resolve, reject) => {
            Ffmpeg.ffprobe(inputFilePath, ['-show_chapters'], async (err, data) => {
                if (err) {
                    const bowlError = new BowlFFProbeError(inputFilePath, err);
                    NutritionLogger.Error(
                        'Initialize new IngredientBowl',
                        {
                            ...baseMeta,
                            subOperations: ['FFProbe'],
                            path: inputFilePath,
                            fileStat,
                            error: bowlError,
                        }
                    );

                    return reject(bowlError);
                }
                // if (!data) {
                //     const bowlError = new BowlFFProbeError(inputFilePath, err);
                //     return reject(bowlError);
                // }

                // // Ensure the video format is supported
                // switch (this.containerType) {
                //     case SUPPORTED_FORMATS.mkv.name:
                //     case SUPPORTED_FORMATS.webm.name:
                //         break;
                //     default: // The video format is not supported
                //         return reject(new Error(`Unsupported video format: ${this.containerType}`));
                // }

                // Get the video file streams
                const ingredients = await Promise.all(data.streams.map(ffProbeStream => IngredientBowl.GatherIngredients(inputFilePath, ffProbeStream)));
                // Get the video chapters if included and add to dressings
                const mappedChapters = data.chapters.map(chapter => new ChaptersIngredientChapter(chapter.id, chapter.time_base, chapter.start, chapter.end, chapter['TAG:title']));
                const chaptersIngredient = new ChaptersIngredient(inputFilePath, mappedChapters);

                return resolve(new IngredientBowl(inputFilePath, data, ingredients, chaptersIngredient));
            });

        });
    }


    private static async GatherIngredients(ingredientFilePath: string, ffProbeStream: Ffmpeg.FfprobeStream) {
        const ingredientType = StreamIngredient.GetIngredientType(ffProbeStream);
        switch (ingredientType) {
            case StreamIngredientType.video: return new VideoIngredient(ingredientFilePath, ffProbeStream);
            case StreamIngredientType.audio: return new AudioIngredient(ingredientFilePath, ffProbeStream);
            case StreamIngredientType.subtitle: return new SubtitleIngredient(ingredientFilePath, ffProbeStream);
            case StreamIngredientType.attachment: return new AttachmentIngredient(ingredientFilePath, ffProbeStream);
            case StreamIngredientType.data: return new DataIngredient(ingredientFilePath, ffProbeStream);
            default:
                NutritionLogger.Warn(
                    'Unknown ingredient type',
                    {
                        location: 'IngredientBowl',
                        functionName: 'GatherIngredients',
                        operation: 'Create new Ingredient from type',
                        // ingredientPath: ingredientFilePath,
                        ingredientType
                    }
                );
                return new DataIngredient(ingredientFilePath, ffProbeStream);
        }
    }

    public get containerType() {
        switch (this.ffProbeData.format.format_name) {
            // case 'matroska,webm':
            //     // Get the video file extension from the video file path
            //     const videoFileExtension = path.extname(this.path).slice(1);
            //     // console.log(`Video File Extension: ${videoFileExtension}`);
            //     return videoFileExtension === SUPPORTED_FORMATS.mkv.name ? SUPPORTED_FORMATS.mkv.name : SUPPORTED_FORMATS.webm.name;
            default: return this.ffProbeData.format.format_name;
        }
    }

    // Duration in seconds
    public get duration() {
        return this.ffProbeData.format.duration;
    }

    public get bitrate() {
        return this.ffProbeData.format.bit_rate;
    }

    // Size in bytes
    public get size() {
        return this.ffProbeData.format.size;
    }

    public get tags(): Tags {
        return this.ffProbeData.format.tags as Tags ?? {} as Tags;
    }

    public addCopiedIngredient(ingredient: StreamIngredient) {
        // Ensure the ingredient is not an original ingredient
        if (ingredient.isOriginal) {
            // Non-critical error, do not throw error
            NutritionLogger.Warn(
                'Cannot add original ingredient',
                {
                    location: 'IngredientBowl',
                    functionName: 'addCopiedIngredient',
                    operation: 'Add copied ingredient',
                    ingredientId: ingredient.id
                }
            );
            return;
        }

        this.ingredients.push(ingredient);
    }

    public removeCopiedIngredient(ingredient: StreamIngredient) {
        // Ensure the ingredient is not an original ingredient
        if (ingredient.isOriginal) {
            // Non-critical error, do not throw error
            NutritionLogger.Warn(
                'Cannot remove original ingredient',
                {
                    location: 'IngredientBowl',
                    functionName: 'removeCopiedIngredient',
                    operation: 'Remove copied ingredient',
                    ingredientId: ingredient.id
                }
            );
            return;
        }

        // Find the ingredientId in the ingredients array
        const index = this.ingredients.indexOf(ingredient);
        // If the ingredientId is found, remove it from the ingredients array
        if (index === -1) {
            // Non-critical error, do not throw error
            NutritionLogger.Warn(
                'Ingredient not found in Bowl',
                {
                    location: 'IngredientBowl',
                    functionName: 'removeCopiedIngredient',
                    operation: 'Remove copied ingredient',
                    subOperations: ['Find ingredient'],
                    ingredientId: ingredient.id
                }
            );
            return;
        }

        this.ingredients.splice(index, 1);
    }
}

export class MixingBowl<TagType extends BowlTags = BowlTags> extends Bowl<TagType> {
    // Only available after mixing
    private ffmpegCommand?: Ffmpeg.FfmpegCommand;

    public statusHistory: MixingBowlStatus[] = [{ time: new Date(), state: 'idle' }];

    constructor(outputFilePath = '') {
        super(outputFilePath);

        // If the outputPath is supplied, validate it
        if (outputFilePath) {
            this.output = outputFilePath;
        }
    }

    // TODO: Set desired bowl type (mkv, webm, avi, etc)

    public get output(): string {
        return this.path;
    }

    public set output(outputPath: string) {
        // // Validate the outputPath is acceptable
        // if (!Object.keys(SUPPORTED_FORMATS).includes(path.extname(outputPath).slice(1).toLowerCase())) {
        //     throw new Error(`Unsupported output format: ${path.extname(outputPath)}`);
        // }

        // // Ensure file permissions
        // fs.access(outputPath, fs.constants.W_OK, (err) => {
        //     if (err) {
        //         throw new Error(`Unable to write to output file: ${outputPath}`);
        //     }
        // });
        this.filePath = outputPath;

    }

    public get tags(): TagType {
        return super.tags ?? {} as TagType;
    }

    public set tags(tags: TagType) {
        this.metadata = tags;
    }

    public get status() {
        return this.statusHistory[this.statusHistory.length - 1];
    }

    public addIngredient(ingredient: StreamIngredient) {
        this.ingredients.push(ingredient);
    }

    public removeIngredient(ingredient: StreamIngredient) {
        // Find the ingredientId in the ingredients array
        const index = this.ingredients.indexOf(ingredient);
        // If the ingredientId is found, remove it from the ingredients array
        if (index === -1) {
            // Non-critical error, do not throw error
            NutritionLogger.Warn(
                'Ingredient not found in Bowl',
                {
                    location: 'MixingBowl',
                    functionName: 'removeIngredient',
                    operation: 'Remove ingredient',
                    subOperations: ['Find ingredient'],
                    ingredientId: ingredient.id
                }
            );
            return;
        }

        this.ingredients.splice(index, 1);
    }

    // TODO: Support adding custom chapters
    // public setChaptersDressing(chaptersDressing?: ChaptersIngredient) {
    //     this.chapters = chaptersDressing;
    // }

    // fluent-ffmpeg does not support pause/resume

    // public pauseMixing() {
    //     const baseMeta: BaseMeta = {
    //         location: 'MixingBowl',
    //         functionName: 'pauseMixing',
    //         operation: 'Pause mixing bowl'
    //     };
    //     NutritionLogger.Debug(
    //         'Pause mixing bowl',
    //         {
    //             ...baseMeta,
    //             bowlId: this.id,
    //             status: this.status
    //         }
    //     );

    //     if (!this.ffmpegCommand || this.status.state !== 'mixing') {
    //         const error = new Error(`Mixing bowl ${this.id}(${this.fileName}) is not mixing`);
    //         NutritionLogger.Error(
    //             'Mixing bowl is not mixing',
    //             {
    //                 ...baseMeta,
    //                 bowlId: this.id,
    //                 status: this.status,
    //                 error
    //             }
    //         );
    //         throw error;
    //     }

    //     this.ffmpegCommand.kill('SIGSTOP');

    //     this.statusHistory.push({
    //         ...this.status,
    //         time: new Date(),
    //         state: 'paused'
    //     });
    // }

    // public resumeMixing() {
    //     const baseMeta: BaseMeta = {
    //         location: 'MixingBowl',
    //         functionName: 'resumeMixing',
    //         operation: 'Resume mixing bowl'
    //     };
    //     NutritionLogger.Debug(
    //         'Resume mixing bowl',
    //         {
    //             ...baseMeta,
    //             bowlId: this.id,
    //             status: this.status
    //         }
    //     );

    //     if (!this.ffmpegCommand || this.status.state !== 'paused') {
    //         const error = new Error(`Mixing bowl ${this.id}(${this.fileName}) has not been paused`);
    //         NutritionLogger.Error(
    //             'Mixing bowl has not been paused',
    //             {
    //                 ...baseMeta,
    //                 bowlId: this.id,
    //                 status: this.status,
    //                 error
    //             }
    //         );

    //         throw error;
    //     }

    //     this.ffmpegCommand.kill('SIGCONT');

    //     this.statusHistory.push({
    //         ...this.status,
    //         time: new Date(),
    //         state: 'mixing'
    //     });
    // }

    public cancelMixing() {
        if (!this.ffmpegCommand || !(this.status.state === 'mixing' || this.status.state === 'paused')) {
            const error = new Error(`Mixing bowl ${this.id}(${this.fileName}) has not been started`);
            NutritionLogger.Error(
                'Mixing bowl has not been started',
                {
                    location: 'MixingBowl',
                    functionName: 'cancelMixing',
                    operation: 'Cancel mixing bowl',
                    bowlId: this.id,
                    status: this.status,
                    error
                }
            );

            throw error;
        }

        this.ffmpegCommand.kill('SIGKILL');

        this.statusHistory.push({
            ...this.status,
            time: new Date(),
            state: 'canceled'
        });
    }

    // Write the output video file to the output path
    public mix(onStatusChange?: (status: MixingBowlStatus) => void) {
        const baseMeta: BaseMeta = {
            location: 'MixingBowl',
            functionName: 'mix',
            operation: 'Mix bowl'
        };

        NutritionLogger.Debug(
            'Mix bowl',
            {
                ...baseMeta,
                bowlId: this.id,
            }
        );

        // Ensure an output path was provided
        if (!this.output) {
            const error = new BowlMixNoOutputError(this.id);
            NutritionLogger.Error(
                'Invalid output path',
                {
                    ...baseMeta,
                    bowlId: this.id,
                    outputPath: this.output,
                    error
                }
            );

            throw error;
        }

        // Ensure at least one ingredient is supplied
        if (!this.allIngredients.length) {
            const error = new BowlMixNoIngredientsError(this.id);
            NutritionLogger.Error(
                'No ingredients supplied',
                {
                    ...baseMeta,
                    bowlId: this.id,
                    error
                }
            );


            throw error;
        }

        // Ensure the outputPath directory exists and is writable
        const outputDirectory = path.dirname(this.path);
        if (!fs.existsSync(outputDirectory)) {
            // create the directory
            fs.mkdirSync(outputDirectory, { recursive: true });
        }

        // Add output to ffmpeg command
        this.ffmpegCommand = Ffmpeg().output(this.path);

        // Get unique inputs
        const ingredientInputsMap: { 
            [filePath: string]: {
                [delay: number]: {
                    delay: number;
                    ingredients: {
                        expectedIngredientIndex: number;
                        ingredient: StreamIngredient;
                    }[];
                }
            }
        } = {};

        function addIngredientToIngredientInputsMap(filePath: string, ingredient: StreamIngredient, expectedIngredientIndex: number, delay = 0) {
            // New input file path
            if (!ingredientInputsMap[filePath]) {
                ingredientInputsMap[filePath] = {};
            }
            // Existing input file path with different delay
            if (!ingredientInputsMap[filePath][delay]) {
                ingredientInputsMap[filePath][delay] = { delay, ingredients: [] };
            }
            // Existing input file path with same delay
            if (!ingredientInputsMap[filePath][delay].ingredients.some(added => added.ingredient.id === ingredient.id)) {
                ingredientInputsMap[filePath][delay].ingredients.push({ expectedIngredientIndex, ingredient });
            }
        }

        this.ingredients.forEach((ingredient, expectedIngredientIndex) => {
            // Ingredients with different delay values require unique inputs
            let delay: number;

            switch (ingredient.type) {
                case StreamIngredientType.video:
                    delay = (ingredient as VideoIngredient).delay;
                    break;
                case StreamIngredientType.audio:
                    delay = (ingredient as AudioIngredient).delay;
                    break;
                case StreamIngredientType.subtitle: {
                    delay = (ingredient as SubtitleIngredient).delay;
                    break;
                }
                default:
                    delay = 0;                 
                    break;
            }

            addIngredientToIngredientInputsMap(ingredient.filePath, ingredient, expectedIngredientIndex, delay);
        });

        // Ensure output path is not the same as any Ingredients
        if (ingredientInputsMap[this.output]) {
            const error = new BowlMixInvalidOutputError(
                this.id,
                this.output,
                this.ingredients
                    .filter((ingredient) => ingredient.filePath === this.output)
                    .map((ingredient) => ingredient.id)
            );
            NutritionLogger.Error(
                'Invalid shared output path',
                {
                    ...baseMeta,
                    bowlId: this.id,
                    outputPath: this.output,
                    error
                }
            );

            throw error;
        }

        // fluent-ffmpeg requires at least one input
        // Use the chapters/metadata Readable stream as the first input

        // Generate custom chapters metadata string or otherwise use a default chapters metadata string
        const customChaptersText = this.chapters?.buildChaptersText();
        const chaptersText = customChaptersText ?? ';FFMETADATA1\n';
        // Create a stream for fluent-ffmpeg to pipe as first input (absoluteInputIndex 0)
        const metadataStream = Readable.from(chaptersText);
        this.ffmpegCommand.input(metadataStream);

        /**
         * Add unique inputs to ffmpeg command
         * Assign index after chapters/metadata input
         * Build and add FFmpeg options/flags for each ingredient
         */
        let absoluteInputIndex = 1;
        const { inputOptions, optionsList } = Object.entries(ingredientInputsMap).reduce(({ inputOptions, optionsList }, [filePath, ingredientInputs]) => {
            Object.values(ingredientInputs).forEach((ingredientInput) => {
                
                // Delayed or advanced (negative delay) inputs are prefixed with -itsoffset
                if (ingredientInput.delay !== 0) {
                    // Add itsoffset option for input
                    inputOptions.push([`-itsoffset`, `${ingredientInput.delay}`]);
                    // inputOptions.push([`-ss`, `${ingredientInput.delay}`]);
                // } else {
                //     // Add copyts option for input
                //     inputOptions.push([`-copyts`, `-start_at_zero`]);
                }
                
                // Add -map_chapters option for non-custom chapters that share the same input as a StreamIngredient
                if (ingredientInput.delay === 0 && this.chapters?.filePath === filePath && !customChaptersText) {
                    // Chapters are independent of expectedIngredientIndex
                    optionsList.push({ expectedIngredientIndex: -1, options: [`-map_chapters`, `${absoluteInputIndex}`] });
                }

                // Add input
                inputOptions.push([`-i`, `${filePath}`]);
                
                // Build and add options for ingredients
                ingredientInput.ingredients.forEach(({ ingredient, expectedIngredientIndex }) => {
                    // if (ingredientInput.delay !== 0) {
                    //     optionsList.push({ expectedIngredientIndex, options: ingredient.buildOptions(absoluteInputIndex, expectedIngredientIndex).concat([`-avoid_negative_ts`, `1`]) });
                    // } else {
                    optionsList.push({ expectedIngredientIndex, options: ingredient.buildOptions(absoluteInputIndex, expectedIngredientIndex) });
                    // }
                });

                // Input added, increment input index
                absoluteInputIndex++;
            });
            return { inputOptions, optionsList };
        }, { inputOptions: [], optionsList: [] } as { inputOptions: string[][], optionsList: { expectedIngredientIndex: number, options: string[] }[] });


        // Sort optionsList by expectedIngredientIndex
        optionsList.sort((a, b) => a.expectedIngredientIndex - b.expectedIngredientIndex);
        const sortedOptions = optionsList.map(({ options }) => options);
        // .concat([`-shortest`]);

        if (this.tags) {
            const metadataOptions = Object.entries(this.tags).reduce((acc, [name, value]) => {
                if (value === undefined) {
                    return acc.concat(`-metadata`, `${name}=`);
                    // acc.push(`-metadata`, ` ${name}= `);
                } else {
                    // Workaround for fluent-ffmpeg bug - Must avoid having only 1 space in options array
                    // Space must be added at the end, padding before string causes issues with tokenization
                    const valueSpacesCount = `${value}`.split(' ').length - 1;
                    return acc.concat(`-metadata`, `${name}=${value}${valueSpacesCount === 1 ? ' ' : ''}`);
                }
            }, [] as string[]);
            sortedOptions.push(metadataOptions);
        }
        
        // FFmpeg requires input options before anything else
        const finalOptions = inputOptions.concat(sortedOptions);
        this.ffmpegCommand.addOptions(finalOptions.flat());

        let nextProgressUpdate = 25;

        this.ffmpegCommand
            .on('start', (command: string) => {
                this.statusHistory.push({
                    time: new Date(),
                    state: 'mixing',
                    fullFfmpegCommand: command
                });
                if (onStatusChange) {
                    onStatusChange(this.status);
                }

                NutritionLogger.Debug(
                    'Mixing Bowl Start',
                    {
                        ...baseMeta,
                        bowlId: this.id,
                        status: this.status
                    }
                );
            })
            .on('codecData', (data: FfmpegCodecData) => {
                this.statusHistory.push({
                    ...this.status,
                    time: new Date(),
                    state: 'mixing',
                    codecData: data
                });
                if (onStatusChange) {
                    onStatusChange(this.status);
                }

                NutritionLogger.Debug(
                    'Mixing Bowl Codec Data',
                    {
                        ...baseMeta,
                        bowlId: this.id,
                        status: this.status
                    }
                );
            })
            .on('progress', (progress: FfmpegProgress) => {
                this.statusHistory.push({
                    ...this.status,
                    time: new Date(),
                    state: 'mixing',
                    progress
                });
                if (onStatusChange) {
                    onStatusChange(this.status);
                }

                // Log progress at every 25%
                if (progress.percent >= nextProgressUpdate) {
                    NutritionLogger.Debug(
                        'Mixing Bowl Progress',
                        {
                            ...baseMeta,
                            bowlId: this.id,
                            status: this.status
                        }
                    );
                    nextProgressUpdate += 25;
                }
            })
            .on('error', (err) => {
                if (err instanceof Error) {
                    if (err.message.startsWith('ffmpeg was killed with signal SIGKILL')) {
                        // No update in status - Intentionally canceled
                        return;
                    }
                }
                this.statusHistory.push({
                    ...this.status,
                    time: new Date(),
                    state: 'error',
                    error: err
                });
                if (onStatusChange) {
                    onStatusChange(this.status);
                }

                NutritionLogger.Error(
                    'Mixing Bowl Error',
                    {
                        ...baseMeta,
                        bowlId: this.id,
                        status: this.status,
                        error: err
                    }
                );
            })
            .on('end', () => {
                this.statusHistory.push({
                    ...this.status,
                    time: new Date(),
                    state: 'done',
                    error: undefined // Unset for clarity
                });
                if (onStatusChange) {
                    onStatusChange(this.status);
                }

                NutritionLogger.Debug(
                    'Mixing Bowl End',
                    {
                        ...baseMeta,
                        bowlId: this.id,
                        status: this.status
                    }
                );
            })
            .run();
    }
}