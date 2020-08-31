// Type definitions for cordova-plugin-cookies
// Project: https://github.com/apache/cordova-plugin-cookies
// Definitions by: Dani Palou <https://github.com/dpalou>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/**
 * Window instance with the plugin object.
 */
export interface WKUserScriptWindow extends Window {
    WKUserScript?: WKUserScript;
}

/**
 * Data to pass for a script.
 */
export interface WKUserScriptData {

    /**
     * An ID to identify the script, to prevent loading the same script twice.
     */
    id: string;

    /**
     * The JS code of the script.
     */
    code?: string;

    /**
     * The path of a JS file to add to the script.
     */
    file?: string;

    /**
     * Injection time. Defaults to WKUserScriptInjectionTime.START.
     */
    injectionTime?: number;
}

/**
 * Constants to define injection time.
 */
export const enum WKUserScriptInjectionTime {
    START = 0,
    END = 1,
}

/**
 * Provides some functions to add user scripts in WKWebView in iOS.
 */
interface WKUserScript {

    /**
     * Add a user script.
     *
     * @param data Data for the script to add.
     * @return Promise resolved when done.
     */
    addScript(data: WKUserScriptData): Promise<void>;
}

export declare var WKUserScript: WKUserScript;
