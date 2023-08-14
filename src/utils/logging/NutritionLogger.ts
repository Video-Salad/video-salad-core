// import package.json
// import pkg from '../../../package.json';
import * as winston from 'winston';

// TODO:
// Enable/disable console/file logging
// Enable/disable levels
// multiple/combined logger(s)
// file location

export interface BaseMeta {
    // File location
    location: string;
    // File Function
    functionName: string;
    // Operation - friendly name for workflow
    operation: string;
    // SubOperations - friendly names for additional workflows
    subOperations?: string[];
}

export interface ErrorMeta<T extends Error = Error> extends BaseMeta {
    error: T;
}

export class NutritionLogger {
    public logger: winston.Logger;

    private static singleton: NutritionLogger;

    constructor() {
        this.logger = winston.createLogger({
            levels: {
                error: 0,
                warn: 1,
                info: 2,
                debug: 3
            },
            level: 'info',
            defaultMeta: {
                application: 'video-salad-core',
                version: '0.0.1'
                // application: pkg.name,
                // version: pkg.version
            },
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({
                    filename: './logs/video-salad.log',
                })
            ],
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.prettyPrint()
            )
        });
    }

    // Ensure singleton instance
    public static get instance(): NutritionLogger {
        if (!NutritionLogger.singleton) {
            NutritionLogger.singleton = new NutritionLogger();
        }
        return NutritionLogger.singleton;

    }

    public static Info<T extends BaseMeta>(message: string, metadata: T) {
        NutritionLogger.instance.logger.info(message, metadata);
    }

    public static Warn<T extends BaseMeta>(message: string, metadata: T) {
        NutritionLogger.instance.logger.warn(message, metadata);
    }

    public static Debug<T extends BaseMeta>(message: string, metadata: T) {
        NutritionLogger.instance.logger.debug(message, metadata);
    }

    public static Error<T extends ErrorMeta<U>, U extends Error = Error>(message: string, metadata?: T) {
        NutritionLogger.instance.logger.error(message, metadata);
    }
}