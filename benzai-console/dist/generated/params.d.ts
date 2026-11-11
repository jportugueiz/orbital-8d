export declare const SCHEMA_VERSION: 6;
export declare const MAX_CHANNELS: 64;
export declare const AUX_COUNT: 4;
export declare const FX_COUNT: 4;
export declare const DCA_COUNT: 8;
export declare const MUTEGROUP_COUNT: 4;
export declare const OUTPUT_SLOTS: 8;
export declare const GROUP_COUNT: 4;
export declare const SCENE_COUNT: 100;
export declare const NAME_MAX_CHARS: 16;
export declare const SHOW_NAME_MAX_CHARS: 32;
export declare const SCENE_NAME_MAX_CHARS: 32;
export declare const HISTORY_MAX_STEPS: 100;
export declare const EDITIONS: readonly [16, 32, 64];
export declare const SAMPLE_RATES: readonly [44100, 48000, 96000];
export type ParamType = 'db' | 'bool' | 'float' | 'int' | 'enum' | 'text';
export interface SceneFamilyDesc {
    readonly id: string;
    readonly labelEs: string;
    readonly recall: boolean;
    readonly defaultScope: boolean;
}
export declare const SCENE_FAMILIES: readonly SceneFamilyDesc[];
export interface PaletteColor {
    readonly id: string;
    readonly labelEs: string;
    readonly css: string;
}
export declare const COLOR_PALETTE: readonly PaletteColor[];
export interface ParamDesc {
    readonly id: string;
    readonly pattern: string;
    readonly type: ParamType;
    readonly min: number;
    readonly max: number;
    readonly def: number | boolean | string;
    readonly offAtMin: boolean;
    readonly unit: string;
    readonly labelEs: string;
    readonly since: string;
    /** enum: nombre de cada valor (el valor es el indice). */
    readonly values: readonly string[];
    /** El valor por defecto es el indice (base uno) de la ruta (patch identidad). */
    readonly defIsIndex: boolean;
    /** Familia de escena (P2): alcance de la recuperacion. */
    readonly family: string;
}
export declare const PARAMS: readonly ParamDesc[];
