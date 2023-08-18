import Ajv from 'ajv';
import { FfprobeStream } from 'fluent-ffmpeg';
// ESM has caused me to spend 40% of my time trying to get this one module to work across all projects
// Perhaps use rollup to transpile iso-639-2 to commonjs and include in bundle
// import * as iso6392 from 'iso-639-2';

import { AudioChanges, AudioConversionOptions, Changes, ConversionChanges, OpusConversionOptions, SubtitleChanges, VideoChanges, opusConversionOptionsSchema } from './Encoders.js';
import { NutritionLogger } from './utils/logging/NutritionLogger.js';
import { JSONSchema } from 'json-schema-typed';

export const enum StreamIngredientType {
    video = 'video',
    audio = 'audio',
    subtitle = 'subtitle',
    attachment = 'attachment',
    data = 'data'
}

export const enum VideoCodec {
    H264 = 'h264',
    H265 = 'hevc',
    // H266 = 'vvc',
    AV1 = 'av1',
    VP9 = 'vp9'
}

export const enum AudioCodec {
    AAC = 'aac',
    AC3 = 'ac3',
    EAC3 = 'eac3',
    DTS = 'dts',
    DTS_HD = 'dts_hd',
    DTS_HD_MA = 'dts_hd_ma',
    DTS_HD_SP = 'dts_hd_sp',
    OPUS = 'opus',
    FLAC = 'flac',
    MP3 = 'mp3'
}

export const enum SubtitleCodec {
    ASS = 'ass',
    SSA = 'ssa',
    SRT = 'srt',
    PSG = 'pgs',
    VOBSUB = 'vobsub',
    WEBVTT = 'webvtt',
}

// https://www.iana.org/assignments/media-types/media-types.xhtml#font
export const enum AttachmentCodec {
    collection = 'collection',
    otf = 'otf',
    sfnt = 'sfnt',
    ttf = 'ttf',
    woff = 'woff',
    woff2 = 'woff2'
}

export const enum DataCodec {
    data = 'data'
}

export type IngredientType = VideoCodec | AudioCodec | SubtitleCodec | AttachmentCodec | DataCodec;

export interface Tags {
    [name: string]: string | undefined;
    title?: string | undefined;
    language?: string | undefined; // ISO 639-2 language code
}

export interface Disposition {
    [name: string]: boolean | undefined;
    default?: boolean;
    dub?: boolean;
    original?: boolean;
    comment?: boolean;
    lyrics?: boolean;
    karaoke?: boolean;
    forced?: boolean;
    hearing_impaired?: boolean;
    visual_impaired?: boolean;
    clean_effects?: boolean;
    attached_pic?: boolean;
    timed_thumbnails?: boolean;
    captions?: boolean;
    descriptions?: boolean;
    metadata?: boolean;
    dependent?: boolean;
    still_image?: boolean;
}

export interface Chapter {
    id: number;
    timeBase: string; // time_base
    start: number;
    end: number;
    // start_time: number;
    // end_time: number;
    title: string; // TAG:title
}

// const UND_LANG = iso6392.iso6392.find(isoLang => isoLang.iso6392B === 'und') as iso6392.Language;

abstract class Ingredient {
    // If necessary, Ids can be changed to the uuid library instead of sequential
    private static NEXT_ID = 0;

    public readonly id: number;

    constructor(public readonly filePath: string, public readonly isOriginal: boolean) {
        // Set the id of the Ingredient and increment the next id
        this.id = Ingredient.NEXT_ID++;
    }

    public abstract copy(): Ingredient;
}

export class ChaptersIngredientChapter {
    constructor(
        readonly id: number,
        private time_base: string,
        private startTime: number,
        private endTime: number,
        private originalTitle: string,
        public isOriginal = true,
        private changes: Partial<Chapter> = {}
    ) { }

    public get start() {
        return this.changes.start ?? this.startTime;
    }

    public set start(start: number) {
        this.changes.start = start;
    }

    public get end() {
        return this.changes.end ?? this.endTime;
    }

    public set end(end: number) {
        this.changes.end = end;
    }

    public get timeBase() {
        return this.changes.timeBase ?? this.timeBase;
    }

    public set timeBase(timeBase: string) {
        this.changes.timeBase = timeBase;
    }

    public get title() {
        return this.changes.title ?? this.title;
    }

    public set title(title: string) {
        this.changes.title = title;
    }

    public get isModified() {
        return Object.keys(this.changes).length > 0;
    }

    public copy() {
        return new ChaptersIngredientChapter(this.id, this.time_base, this.startTime, this.endTime, this.originalTitle, false, { ...this.changes });
    }
}

export class ChaptersIngredient extends Ingredient {
    constructor(filePath: string, public chapters: ChaptersIngredientChapter[] = [], isOriginal = true) {
        super(filePath, isOriginal);
    }

    public buildChaptersText() {
        return this.chapters.some(chapter => chapter.isModified)
            ? this.chapters.reduce((prev, chapter) => `${prev}[CHAPTER]\nTIMEBASE=${chapter.timeBase}\nSTART=${chapter.start}\nEND=${chapter.end}\ntitle=${chapter.title}\n`, `;FFMETADATA1\n`)
            : undefined;
    }

    public copy() {
        return new ChaptersIngredient(
            this.filePath,
            this.chapters.map(chapter => {
                return chapter.copy();
            }),
            false
        );
    }
}

// Individual track in the Ingredient container
export abstract class StreamIngredient<T extends IngredientType = IngredientType, U extends Changes<T> = Changes<T>> extends Ingredient {
    protected ffProbeStream: FfprobeStream;
    protected changes = {} as U;
    protected conversionChanges = {} as ConversionChanges;

    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public abstract copy(): StreamIngredient<T, U>;

    public static GetIngredientType(ffProbeStream: FfprobeStream): StreamIngredientType {
        switch (ffProbeStream.codec_type) {
            case StreamIngredientType.video: return StreamIngredientType.video;
            case StreamIngredientType.audio: return StreamIngredientType.audio;
            case StreamIngredientType.subtitle: return StreamIngredientType.subtitle;
            case StreamIngredientType.attachment: return StreamIngredientType.attachment;
            case StreamIngredientType.data: return StreamIngredientType.data;
            default:
                console.warn(`Unknown codec type: ${ffProbeStream.codec_type}`);
                return StreamIngredientType.data; // TODO: Check for other types and support them
        }
    }

    public static ParseDuration(duration: string) {
        const durationSplit = duration.split(':');
        if (durationSplit.length !== 3) {
            return 0;
        }
        return Number(durationSplit[0]) * 60 * 60 + Number(durationSplit[1]) * 60 + Number(durationSplit[2]);
    }

    // Codec of the stream
    public abstract get codec(): T;

    // Stream codec type
    public get type(): StreamIngredientType {
        return StreamIngredient.GetIngredientType(this.ffProbeStream);
    }

    // Index of the stream
    public get index() {
        return Number(this.ffProbeStream.index);
    }

    
    /**
     * Retrieves the duration in seconds of the stream.
     *
     * @return {number} The duration in seconds of the stream.
     */
    public get duration() {
        const duration = this.ffProbeStream.duration
            ?? this.ffProbeStream.tags['DURATION']
            ?? '';
        return StreamIngredient.ParseDuration(duration);
    }

    public get tags(): Tags {
        return Object.assign({}, this.ffProbeStream.tags, this.changes?.tags);
    }

    public set tags(tags: Tags) {
        if (!this.changes.tags) {
            this.changes.tags = tags;
        }
        Object.assign(this.changes.tags, tags);
    }

    public get title() {
        return this.changes?.tags?.title ?? this.tags.title;
    }

    public set title(title: Tags['title']) {
        if (!this.changes.tags) {
            this.changes.tags = {};
        }
        this.changes.tags.title = title;
    }

    // Language tag must be in ISO 639-2 format
    public get language() {
        // return iso6392.iso6392.find(isoLang => isoLang.iso6392B === (this.tags.language));
        return this.changes?.tags?.language ?? this.tags.language;
    }

    public set language(language: string | undefined) {
        if (!this.changes.tags) {
            this.changes.tags = {};
        }

        if (typeof language === 'undefined') {
            this.changes.tags.language = '';
        } else {
            this.changes.tags.language = language;
            // this.changes.tags.language = language.iso6392B;
        }
    }

    public get dispositions() {
        if (this.changes.dispositions) {
            return this.changes.dispositions;
        }

        const disposition: Disposition = {};
        Object.entries(this.ffProbeStream.disposition ?? {}).forEach(([key, value]) => {
            if (value === 1) {
                disposition[key] = true;
            }
            // disposition[key] = value === 1;
        });
        return disposition;
    }

    public set dispositions(disposition: Disposition) {
        this.changes.dispositions = disposition;
    }

    public get conversion(): ConversionChanges {
        return this.conversionChanges;
    }

    public abstract get conversionOptionsSchema(): { [conversionOptionName: string]: JSONSchema };

    public getTag(tagName: string) {
        return this.changes?.tags?.[tagName] ?? this.tags[tagName];
    }

    // Set custom metadata
    public setTag(tagName: string, tagValue: string | undefined) {
        if (!this.changes.tags) {
            this.changes.tags = {};
        }
        this.changes.tags[tagName] = tagValue;
    }

    protected copyStream<T extends StreamIngredient>(newCopiedIngredient: T) {
        // Clone changes: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
        newCopiedIngredient.changes = structuredClone(this.changes);

        return newCopiedIngredient;
    }

    public convert(options: ConversionChanges) {
        NutritionLogger.Debug(
            'Convert Ingredient',
            {
                location: 'StreamIngredient',
                functionName: 'convert',
                operation: 'Convert Ingredient',
                ingredientId: this.id,
                ingredientType: this.type,
                options
            }
        );

        this.conversionChanges = options;
    }

    // Build ffmpeg options from changes
    public buildOptions(ingredientInputIndex: number, expectedIngredientIndex: number) {
        const options: string[] = [];

        // Map the stream
        options.push(`-map ${ingredientInputIndex}:${this.index}`);

        // No changes or encoding (conversion)
        if (!this.conversionChanges.codec || this.conversionChanges.codec) {
            // No changes - Stream copy the original track
            options.push(`-c:${expectedIngredientIndex} copy`);
        }

        // Custom options (ex. filters, conversion)
        if (this.changes?.customOptions?.length) {
            options.push(...this.changes.customOptions.map(optionFn => optionFn(ingredientInputIndex, expectedIngredientIndex)));
        }

        // Copy metadata
        options.push(`-map_metadata:s:${expectedIngredientIndex} ${ingredientInputIndex}:s:${this.index}`);

        // Apply metadata changes
        Object.entries(this.changes.tags ?? {}).forEach(([name, value]) => {
            if (value === undefined) {
                options.push(`-metadata:s:${expectedIngredientIndex}`, `${name}=`);
            } else {
                // Workaround for fluent-ffmpeg bug - Must avoid having only 1 space in options array
                // Space must be added at the end, padding before string causes issues with tokenization
                const valueSpacesCount = `${value}`.split(' ').length - 1;
                options.push(`-metadata:s:${expectedIngredientIndex}`, `${name}=${value}${valueSpacesCount === 1 ? ' ' : ''}`);
            }
        });

        // Apply disposition
        if (this.changes.dispositions) {
            const dispositionOption = Object.entries(this.changes.dispositions).reduce((option, [name, value]) => {
                return option.concat(`${value ? `+${name}` : `-${name}`}`);
            }, ``);
            options.push(`-disposition:${expectedIngredientIndex}`, `${dispositionOption}`);
        }

        return options;
    }
}

export class VideoIngredient extends StreamIngredient<VideoCodec, VideoChanges> {

    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, ffProbeStream, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public get codec() {
        switch (this.ffProbeStream.codec_name) {
            case VideoCodec.H264: return VideoCodec.H264;
            case VideoCodec.H265: return VideoCodec.H265;
            // case VideoCodec.H266: return VideoCodec.H266;
            case VideoCodec.AV1: return VideoCodec.AV1;
            case VideoCodec.VP9: return VideoCodec.VP9;
            default:
                console.warn(`Unsupported video codec: ${this.ffProbeStream.codec_name}`);
                return this.ffProbeStream.codec_name as VideoCodec; // TODO: Check for other types and support them
        }
    }

    public get bitrate() {
        return Number(this.ffProbeStream.bit_rate !== 'N/A' ? this.ffProbeStream.bit_rate : this.ffProbeStream.tags['BPS']);
    }

    // Size in bytes
    public get size() {
        if (this.ffProbeStream.tags['NUMBER_OF_BYTES']) {
            return Number(this.ffProbeStream.tags['NUMBER_OF_BYTES']);
        } else {
            return (this.duration * this.bitrate ?? 0) / 8;
        }
    }

    public get width() {
        return Number(this.ffProbeStream.width);
    }

    public get height() {
        return Number(this.ffProbeStream.height);
    }

    public get averageFrameRate() {
        return this.ffProbeStream.avg_frame_rate;
    }

    public get totalFrames() {
        return Number(this.ffProbeStream.tags['NUMBER_OF_FRAMES']);
    }

    public set title(title: string) {
        this.changes.title = title;
    }
   
    public get delay() {
        return this.changes.delay ?? 0;
    }

    public set delay(seconds: number) {
        this.changes.delay = seconds;
    }

    // TODO: Implement video conversion options
    public get conversionOptionsSchema() {
        return {

        };
    }

    public copy() {
        const copiedIngredient = new VideoIngredient(
            this.filePath,
            this.ffProbeStream,
            false
        );
        this.copyStream(copiedIngredient);

        return copiedIngredient;
    }
}

export class AudioIngredient extends StreamIngredient<AudioCodec, AudioChanges> {
    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, ffProbeStream, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public get codec() {
        if (this.changes.codec) {
            return this.changes.codec;
        }

        switch (this.ffProbeStream.codec_name) {
            case AudioCodec.AAC: return AudioCodec.AAC;
            case AudioCodec.AC3: return AudioCodec.AC3;
            case AudioCodec.EAC3: return AudioCodec.EAC3;
            case AudioCodec.DTS: return AudioCodec.DTS;
            case AudioCodec.DTS_HD: return AudioCodec.DTS_HD;
            case AudioCodec.DTS_HD_MA: return AudioCodec.DTS_HD_MA;
            case AudioCodec.DTS_HD_SP: return AudioCodec.DTS_HD_SP;
            case AudioCodec.OPUS: return AudioCodec.OPUS;
            case AudioCodec.FLAC: return AudioCodec.FLAC;
            case AudioCodec.MP3: return AudioCodec.MP3;
            default:
                console.warn(`Unsupported audio codec: ${this.ffProbeStream.codec_name}`);
                return this.ffProbeStream.codec_name as AudioCodec; // TODO: Check for other types and support them
        }
    }

    public get bitrate() {
        return Number(this.ffProbeStream.bit_rate !== 'N/A' ? this.ffProbeStream.bit_rate : this.ffProbeStream.tags['BPS']);
    }

    public set bitrate(value: number) {
        // bitrate adjustment requires converting with the same codec
        this.changes.codec = this.changes.codec ?? this.codec;
        this.changes.bitrate = value;
    }

    public get averageFrameRate() {
        return this.ffProbeStream.avg_frame_rate;
    }
    
    public get totalFrames() {
        return Number(this.ffProbeStream.tags['NUMBER_OF_FRAMES']);
    }

    // Size in bytes
    public get size() {
        if (this.ffProbeStream.tags['NUMBER_OF_BYTES']) {
            return Number(this.ffProbeStream.tags['NUMBER_OF_BYTES']);
        } else {
            return (this.duration * this.bitrate ?? 0) / 8;
        }
    }

    public get sampleRate() {
        return this.changes?.sampleRate ?? Number(this.ffProbeStream.sample_rate);
    }

    public get channels() {
        return this.changes?.channels ?? Number(this.ffProbeStream.channels);
    }

    public get delay() {
        return this.changes.delay ?? 0;
    }

    public set delay(seconds: number) {
        this.changes.delay = seconds;
    }

    public get conversionOptionsSchema() {
        // TODO: Limit conversion options based on FFMPEG capabilities
        return {
            opus: opusConversionOptionsSchema
        };
    }

    public copy() {
        const copiedIngredient = new AudioIngredient(
            this.filePath,
            this.ffProbeStream,
            false
        );
        this.copyStream(copiedIngredient);

        return copiedIngredient;
    }

    public convert(options: AudioConversionOptions) {
        // Validate conversion options
        switch (options.codec) {
            case 'opus':
                this.convertOpus(options as OpusConversionOptions);
                break;
            // case 'aac':
            // case AudioCodec.AC3:
            // case AudioCodec.EAC3:
            // case AudioCodec.DTS:
            // case AudioCodec.DTS_HD:
            // case AudioCodec.DTS_HD_MA:
            // case AudioCodec.DTS_HD_SP:
            // case AudioCodec.FLAC:
            // case AudioCodec.MP3:
            default: {
                const error = Error(`Unsupported audio codec: ${this.changes.codec}`);
                NutritionLogger.Error(
                    'Unsupported Codec',
                    {
                        location: 'AudioIngredient',
                        functionName: 'convert',
                        operation: 'Convert Ingredient',
                        error
                    }
                );

                throw error;
            }
        }

        super.convert(options);
    }

    // Build ffmpeg options from changes
    public buildOptions(ingredientInputIndex: number, expectedIngredientIndex: number) {
        const options: string[] = super.buildOptions(ingredientInputIndex, expectedIngredientIndex);

        // Handle codec conversion
        if (this.conversionChanges.codec) {
            // Ensure the conversion options provided are valid audio conversion options
            switch (this.conversionChanges.codec) {
                // TODO: Add support for other audio codecs
                case 'opus':
                    options.push(...this.handleOpusConversion(expectedIngredientIndex, this.conversionChanges as OpusConversionOptions));
                    break;
                // case AudioCodec.AAC:
                // case AudioCodec.AC3:
                // case AudioCodec.EAC3:
                // case AudioCodec.DTS:
                // case AudioCodec.DTS_HD:
                // case AudioCodec.DTS_HD_MA:
                // case AudioCodec.DTS_HD_SP:
                // case AudioCodec.FLAC:
                // case AudioCodec.MP3:
                default: throw Error(`Unsupported audio codec: ${this.conversionChanges.codec}`);
            }
        }

        // Handle Audio conversion
        if (this.conversionChanges.bitrate) {
            options.push(`-b:${expectedIngredientIndex} ${this.conversionChanges.bitrate}`);
        }
        if (this.conversionChanges.channels) {
            options.push(`-ac:${expectedIngredientIndex} ${this.conversionChanges.channels}`);
        }
        // if (options.sampleFormat) {
        // }
        // if (options.sampleRate) {
        // }

        return options;
    }

    // Validate OPUS conversion options
    private convertOpus(options: OpusConversionOptions) {
        // Validate with Ajv
        const ajv = new Ajv();
        const validate = ajv.compile(opusConversionOptionsSchema);
        if (!validate(options)) {
            // TODO: custom errors
            const error = new Error('Invalid OPUS conversion options');
            NutritionLogger.Error(
                'Invalid OPUS conversion options',
                {
                    location: 'AudioIngredient',
                    functionName: 'convertOpus',
                    operation: 'Convert Ingredient',
                    subOperations: [],
                    options,
                    ingredientId: this.id,
                    ingredientType: this.type,
                    ingredientCodec: this.codec,
                    error,
                    validate,
                }
            );

            throw error;
        }

        this.convertAudio(options);
    }

    private convertAudio(options: AudioConversionOptions) {
        if (options.bitrate) {
            if (options.bitrate <= 0) {
                throw Error(`Unsupported bitrate: ${options.bitrate}`);
            }
        }
        // if (options.channels) {
        // }
        // if (options.sampleFormat) {
        // }
        // if (options.sampleRate) {
        // }
    }

    private handleOpusConversion(index: number, changes: OpusConversionOptions) {
        const options = [`-c:${index} libopus`];

        if (changes.compression_level) {
            options.push(`-compression_level:${index} ${changes.compression_level}`);
        }
        if (changes.frame_duration) {
            options.push(`-frame_duration:${index} ${changes.frame_duration}`);
        }
        if (changes.vbr) {
            options.push(`-vbr:${index} ${changes.vbr}`);
        }

        // Might be necessary to avoid errors: https://www.reddit.com/r/ffmpeg/comments/v4s61h/correctly_mapping_51_to_opus/

        return options;
    }

}

export class SubtitleIngredient extends StreamIngredient<SubtitleCodec, SubtitleChanges> {
    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, ffProbeStream, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public get codec() {
        switch (this.ffProbeStream.codec_name) {
            case SubtitleCodec.ASS: return SubtitleCodec.ASS;
            case SubtitleCodec.SSA: return SubtitleCodec.SSA;
            case SubtitleCodec.SRT: return SubtitleCodec.SRT;
            case SubtitleCodec.PSG: return SubtitleCodec.PSG;
            case SubtitleCodec.VOBSUB: return SubtitleCodec.VOBSUB;
            default:
                console.warn(`Unsupported subtitle codec: ${this.ffProbeStream.codec_name}`);
                return this.ffProbeStream.codec_name as SubtitleCodec; // TODO: Check for other types and support them
        }
    }

    public get bitrate() {
        return Number(this.ffProbeStream.bit_rate !== 'N/A' ? this.ffProbeStream.bit_rate : this.ffProbeStream.tags['BPS']);
    }

    public get averageFrameRate() {
        return this.ffProbeStream.avg_frame_rate;
    }

    public get totalFrames() {
        return Number(this.ffProbeStream.tags['NUMBER_OF_FRAMES']);
    }

    // Size in bytes
    public get size() {
        if (this.ffProbeStream.tags['NUMBER_OF_BYTES']) {
            return Number(this.ffProbeStream.tags['NUMBER_OF_BYTES']);
        } else {
            return (this.duration * this.bitrate ?? 0) / 8;
        }
    }

    public get conversionOptionsSchema() {
        return {};
    }

    
    public get delay() {
        return this.changes.delay ?? 0;
    }

    public set delay(seconds: number) {
        this.changes.delay = seconds;
    }

    public copy() {
        const copiedIngredient = new SubtitleIngredient(
            this.filePath,
            this.ffProbeStream,
            false
        );
        this.copyStream(copiedIngredient);

        return copiedIngredient;
    }
}

export class AttachmentIngredient extends StreamIngredient<AttachmentCodec> {
    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, ffProbeStream, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public get codec() {
        switch (this.ffProbeStream.codec_name) {
            case AttachmentCodec.collection: return AttachmentCodec.collection;
            case AttachmentCodec.otf: return AttachmentCodec.otf;
            case AttachmentCodec.ttf: return AttachmentCodec.ttf;
            case AttachmentCodec.sfnt: return AttachmentCodec.sfnt;
            case AttachmentCodec.woff: return AttachmentCodec.woff;
            case AttachmentCodec.woff2: return AttachmentCodec.woff2;
            default:
                console.warn(`Unsupported attachment codec: ${this.ffProbeStream.codec_name}`);
                return this.ffProbeStream.codec_name as AttachmentCodec; // TODO: Check for other types and support them
        }
    }

    public get fileName(): string {
        return this.ffProbeStream.tags.filename;
    }

    public get mimeType(): string {
        return this.ffProbeStream.tags.mimetype;
    }

    public get conversionOptionsSchema() {
        return {};
    }

    public copy() {
        const copiedIngredient = new AttachmentIngredient(
            this.filePath,
            this.ffProbeStream,
            false
        );
        this.copyStream(copiedIngredient);

        return copiedIngredient;
    }

    public buildOptions(ingredientIndex: number, expectedDressingIndex: number) {
        const options = super.buildOptions(ingredientIndex, expectedDressingIndex);

        // TODO: Support non-mkv formats
        // Font attachments
        // map_metadata does not work with attachments
        if (this.fileName && this.mimeType) {
            // Workaround for fluent-ffmpeg bug - Must avoid having only 1 space in options array
            // Space must be added at the end, padding before string causes issues with tokenization
            const fileNameSpacesCount = this.fileName.split(' ').length - 1;
            const fileNameOptions = [`-metadata:s:${expectedDressingIndex}`, `filename=${this.fileName}${fileNameSpacesCount === 1 ? ' ' : ''}`];
            const mimeTypeSpacesCount = this.mimeType.split(' ').length - 1;
            const mimeTypeOptions = [`-metadata:s:${expectedDressingIndex}`, `mimetype=${this.mimeType}${mimeTypeSpacesCount === 1 ? ' ' : ''}`];
            options.push(...fileNameOptions, ...mimeTypeOptions);
        }

        return options;
    }
}

export class DataIngredient extends StreamIngredient<DataCodec> {
    constructor(filePath: string, ffProbeStream: FfprobeStream, isOriginal = true) {
        super(filePath, ffProbeStream, isOriginal);

        this.ffProbeStream = ffProbeStream;
    }

    public get codec() {
        return DataCodec.data;
    }

    public get conversionOptionsSchema() {
        return {};
    }

    public copy() {
        const copiedIngredient = new DataIngredient(
            this.filePath,
            this.ffProbeStream,
            false
        );
        this.copyStream(copiedIngredient);

        return copiedIngredient;
    }
}