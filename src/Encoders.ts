import { JSONSchema } from 'json-schema-typed';
import { AudioCodec, Disposition, IngredientType, SubtitleCodec, Tags, VideoCodec } from './Ingredient.js';

export interface Changes<T = IngredientType> {
    codec?: T;
    tags?: Partial<Tags>;
    dispositions?: Disposition;
    customOptions?: ((ingredientIndex: number, expectedDressingIndex: number) => string)[];
    [option: string]: unknown;
}

export interface ConversionChanges {
    codec: string;
    [option: string]: string | number | boolean | undefined;
}

//#region Audio Changes

// Common audio parameters
export interface AudioChanges extends Changes<AudioCodec> {
    codec: AudioCodec;
    delay?: number;
    sampleFormat?: string;
    sampleRate?: string;
    channels?: string;
    bitrate?: number;
}

export interface AudioConversionOptions extends ConversionChanges {
    codec: 'aac' | 'ac3' | 'eac3' | 'dts' | 'dts_hd' | 'dts_hd_ma' | 'dts_hd_sp' | 'opus' | 'flac' | 'mp3';
    sampleFormat?: string;
    sampleRate?: string;
    channels?: string;
    // volume?: number; // 256 default
    bitrate?: number; // TODO: Add support for a string - ex. '128k'
}

const audioConversionOptionsSchema = {
    type: 'object',
    required: ['codec'],
    properties: {
        codec: {
            type: 'string',
            enum: [
                'aac',
                'ac3',
                'eac3',
                'dts',
                'dts_hd',
                'dts_hd_ma',
                'dts_hd_sp',
                'opus',
                'flac',
                'mp3'
            ],
        },
        sampleFormat: {
            type: 'string',
        },
        sampleRate: {
            type: 'string',
        },
        channels: {
            type: 'string',
        },
        bitrate: {
            type: 'number',
        }
    }
} satisfies JSONSchema;

//#region AAC Conversion
export interface AACConversionOptions extends AudioConversionOptions {
    codec: 'aac';
    q?: string; // Quality for Variable bit rate (VBR) mode
    profile?: 'aac_low' | 'mpeg2_aac_low' | 'aac_ltp' | 'aac_main';
}

//#endregion AAC Conversion

//#region OPUS Conversion

// https://ffmpeg.org/ffmpeg-codecs.html#toc-libopus-1
export interface OpusConversionOptions extends AudioConversionOptions {
    codec: 'opus';
    vbr?: 'off' | 'on' | 'constrained';
    compression_level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10; // Default 10
    frame_duration?: 2.5 | 5 | 10 | 20 | 40 | 60; // Default 20
}

export const opusConversionOptionsSchema = {
    ...audioConversionOptionsSchema,
    properties: {
        ...audioConversionOptionsSchema.properties,
        // Overwrite codec with OPUS only
        codec: {
            type: 'string',
            enum: [
                'opus'
            ],
        },
        bitrate: {
            type: 'number',
            minimum: 0,
        },
        vbr: {
            type: 'string',
            enum: [
                'off',
                'on',
                'constrained'
            ]
        },
        compression_level: {
            type: 'number',
            minimum: 0,
            maximum: 10,
            default: 10
        },
        frame_duration: {
            type: 'number',
            enum: [
                2.5,
                5,
                10,
                20,
                40,
                60
            ],
            default: 20
        }
    }
} satisfies JSONSchema;

//#endregion OPUS Conversion

//#endregion Audio Changes

//#region Video Changes

// Common subtitle parameters
export interface VideoChanges extends Changes<VideoCodec> {
    // codec: VideoCodec;
    delay?: number;
}

//#endregion Video Changes

//#region Subtitle Changes

// Common subtitle parameters
export interface SubtitleChanges extends Changes<SubtitleCodec> {
    // codec: SubtitleCodec;
    delay?: number;
}

//#endregion Subtitle Changes
