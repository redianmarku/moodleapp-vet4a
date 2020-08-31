// Type definitions for cordova-plugin-cookies
// Project: https://github.com/apache/cordova-plugin-cookies
// Definitions by: Dani Palou <https://github.com/dpalou>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/**
 * Window instance with the plugin object.
 */
export interface WKWebViewCookiesWindow extends Window {
    WKWebViewCookies?: WKWebViewCookies;
}

/**
 * Data for a cookie.
 */
export interface Cookie {

    /**
     * Cookie's name.
     */
    name: string;

    /**
     * Cookie's value.
     */
    value: string;

    /**
     * Cookie's domain.
     */
    domain: string;

    /**
     * Cookie's path. Defaults to empty path.
     */
    path?: string;
}

/**
 * Provides some functions to handle cookies in WKWebView in iOS.
 */
interface WKWebViewCookies {

    /**
     * Set a cookie.
     *
     * @param cookie The cookie to set.
     * @return Promise resolved when done.
     */
    setCookie(cookie: Cookie): Promise<void>;
}

export declare var WKWebViewCookies: WKWebViewCookies;
