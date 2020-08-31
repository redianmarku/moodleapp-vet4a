// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { CoreLangProvider } from '../lang';
import { CoreTextUtilsProvider } from './text';
import { makeSingleton } from '@singletons/core.singletons';
import { CoreConfigConstants } from '../../configconstants';
import { CoreUrl } from '@singletons/url';

/*
 * "Utils" service with helper functions for URLs.
 */
@Injectable()
export class CoreUrlUtilsProvider {

    constructor(private langProvider: CoreLangProvider, private textUtils: CoreTextUtilsProvider) { }

    /**
     * Add or remove 'www' from a URL. The url needs to have http or https protocol.
     *
     * @param url URL to modify.
     * @return Modified URL.
     */
    addOrRemoveWWW(url: string): string {
        if (url) {
            if (url.match(/http(s)?:\/\/www\./)) {
                // Already has www. Remove it.
                url = url.replace('www.', '');
            } else {
                url = url.replace('https://', 'https://www.');
                url = url.replace('http://', 'http://www.');
            }
        }

        return url;
    }

    /**
     * Add params to a URL.
     *
     * @param url URL to add the params to.
     * @param params Object with the params to add.
     * @param anchor Anchor text if needed.
     * @param boolToNumber Whether to convert bools to 1 or 0.
     * @return URL with params.
     */
    addParamsToUrl(url: string, params?: {[key: string]: any}, anchor?: string, boolToNumber?: boolean): string {
        let separator = url.indexOf('?') != -1 ? '&' : '?';

        for (const key in params) {
            let value = params[key];

            if (boolToNumber && typeof value == 'boolean') {
                // Convert booleans to 1 or 0.
                value = value ? 1 : 0;
            }

            // Ignore objects.
            if (typeof value != 'object') {
                url += separator + key + '=' + value;
                separator = '&';
            }
        }

        if (anchor) {
            url += '#' + anchor;
        }

        return url;
    }

    /**
     * Given a URL and a text, return an HTML link.
     *
     * @param url URL.
     * @param text Text of the link.
     * @return Link.
     */
    buildLink(url: string, text: string): string {
        return '<a href="' + url + '">' + text + '</a>';
    }

    /**
     * Check whether we can use tokenpluginfile.php endpoint for a certain URL.
     *
     * @param url URL to check.
     * @param siteUrl The URL of the site the URL belongs to.
     * @param accessKey User access key for tokenpluginfile.
     * @return Whether tokenpluginfile.php can be used.
     */
    canUseTokenPluginFile(url: string, siteUrl: string, accessKey?: string): boolean {
        // Do not use tokenpluginfile if site doesn't use slash params, the URL doesn't work.
        // Also, only use it for "core" pluginfile endpoints. Some plugins can implement their own endpoint (like customcert).
        return accessKey && !url.match(/[\&?]file=/) && (
                url.indexOf(this.textUtils.concatenatePaths(siteUrl, 'pluginfile.php')) === 0 ||
                url.indexOf(this.textUtils.concatenatePaths(siteUrl, 'webservice/pluginfile.php')) === 0);
    }

    /**
     * Extracts the parameters from a URL and stores them in an object.
     *
     * @param url URL to treat.
     * @return Object with the params.
     */
    extractUrlParams(url: string): any {
        const regex = /[?&]+([^=&]+)=?([^&]*)?/gi,
            subParamsPlaceholder = '@@@SUBPARAMS@@@',
            params: any = {},
            urlAndHash = url.split('#'),
            questionMarkSplit = urlAndHash[0].split('?');
        let subParams;

        if (questionMarkSplit.length > 2) {
            // There is more than one question mark in the URL. This can happen if any of the params is a URL with params.
            // We only want to treat the first level of params, so we'll remove this second list of params and restore it later.
            questionMarkSplit.splice(0, 2);

            subParams = '?' + questionMarkSplit.join('?');
            urlAndHash[0] = urlAndHash[0].replace(subParams, subParamsPlaceholder);
        }

        urlAndHash[0].replace(regex, (match: string, key: string, value: string): string => {
            params[key] = typeof value != 'undefined' ? this.textUtils.decodeURIComponent(value) : '';

            if (subParams) {
                params[key] = params[key].replace(subParamsPlaceholder, subParams);
            }

            return match;
        });

        if (urlAndHash.length > 1) {
            // Remove the URL from the array.
            urlAndHash.shift();

            // Add the hash as a param with a special name. Use a join in case there is more than one #.
            params.urlHash = urlAndHash.join('#');
        }

        return params;
    }

    /**
     * Generic function for adding the wstoken to Moodle urls and for pointing to the correct script.
     * For download remote files from Moodle we need to use the special /webservice/pluginfile passing
     * the ws token as a get parameter.
     *
     * @param url The url to be fixed.
     * @param token Token to use.
     * @param siteUrl The URL of the site the URL belongs to.
     * @param accessKey User access key for tokenpluginfile.
     * @return Fixed URL.
     */
    fixPluginfileURL(url: string, token: string, siteUrl: string, accessKey?: string): string {
        if (!url) {
            return '';
        }

        url = url.replace(/&amp;/g, '&');

        const canUseTokenPluginFile = accessKey && this.canUseTokenPluginFile(url, siteUrl, accessKey);

        // First check if we need to fix this url or is already fixed.
        if (!canUseTokenPluginFile && url.indexOf('token=') != -1) {
            return url;
        }

        // Check if is a valid URL (contains the pluginfile endpoint) and belongs to the site.
        if (!this.isPluginFileUrl(url) || url.indexOf(this.textUtils.addEndingSlash(siteUrl)) !== 0) {
            return url;
        }

        // Check if is a valid URL (contains the pluginfile endpoint) and belongs to the site.
        if (!this.isPluginFileUrl(url) || url.indexOf(this.textUtils.addEndingSlash(siteUrl)) !== 0) {
            return url;
        }

        if (canUseTokenPluginFile) {
            // Use tokenpluginfile.php.
            url = url.replace(/(\/webservice)?\/pluginfile\.php/, '/tokenpluginfile.php/' + accessKey);

            return url;
        }

        // No access key, use pluginfile.php. Check if the URL already has params.
        if (url.match(/\?[^=]+=/)) {
            url += '&';
        } else {
            url += '?';
        }
        // Always send offline=1 (for external repositories). It shouldn't cause problems for local files or old Moodles.
        url += 'token=' + token + '&offline=1';

        // Some webservices returns directly the correct download url, others not.
        if (url.indexOf(this.textUtils.concatenatePaths(siteUrl, 'pluginfile.php')) === 0) {
            url = url.replace('/pluginfile', '/webservice/pluginfile');
        }

        return url;
    }

    /**
     * Formats a URL, trim, lowercase, etc...
     *
     * @param url The url to be formatted.
     * @return Fromatted url.
     */
    formatURL(url: string): string {
        url = url.trim();

        // Check if the URL starts by http or https.
        if (! /^http(s)?\:\/\/.*/i.test(url)) {
            // Test first allways https.
            url = 'https://' + url;
        }

        // http always in lowercase.
        url = url.replace(/^http/i, 'http');
        url = url.replace(/^https/i, 'https');

        // Replace last slash.
        url = url.replace(/\/$/, '');

        return url;
    }

    /**
     * Returns the URL to the documentation of the app, based on Moodle version and current language.
     *
     * @param release Moodle release.
     * @param page Docs page to go to.
     * @return Promise resolved with the Moodle docs URL.
     */
    getDocsUrl(release?: string, page: string = 'Mobile_app'): Promise<string> {
        let docsUrl = 'https://docs.moodle.org/en/' + page;

        if (typeof release != 'undefined') {
            const version = release.substr(0, 3).replace('.', '');
            // Check is a valid number.
            if (parseInt(version) >= 24) {
                // Append release number.
                docsUrl = docsUrl.replace('https://docs.moodle.org/', 'https://docs.moodle.org/' + version + '/');
            }
        }

        return this.langProvider.getCurrentLanguage().then((lang) => {
            return docsUrl.replace('/en/', '/' + lang + '/');
        }).catch(() => {
            return docsUrl;
        });
    }

    /**
     * Returns the Youtube Embed Video URL or null if not found.
     *
     * @param  url URL
     * @return Youtube Embed Video URL or null if not found.
     */
    getYoutubeEmbedUrl(url: string): string {
        if (!url) {
            return;
        }

        let videoId;
        const params: any = {};

        url = this.textUtils.decodeHTML(url);

        // Get the video ID.
        let match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);

        if (match && match[2].length === 11) {
            videoId = match[2];
        }

        // No videoId, do not continue.
        if (!videoId) {
            return;
        }

        // Now get the playlist (if any).
        match = url.match(/[?&]list=([^#\&\?]+)/);

        if (match && match[1]) {
            params.list = match[1];
        }

        // Now get the start time (if any).
        match = url.match(/[?&]start=(\d+)/);

        if (match && match[1]) {
            params.start = parseInt(match[1], 10);
        } else {
            // No start param, but it could have a time param.
            match = url.match(/[?&]t=(\d+h)?(\d+m)?(\d+s)?/);
            if (match) {
                params.start = (match[1] ? parseInt(match[1], 10) * 3600 : 0) + (match[2] ? parseInt(match[2], 10) * 60 : 0) +
                        (match[3] ? parseInt(match[3], 10) : 0);
            }
        }

        return this.addParamsToUrl('https://www.youtube.com/embed/' + videoId, params);
    }

    /**
     * Given a URL, returns what's after the last '/' without params.
     * Example:
     * http://mysite.com/a/course.html?id=1 -> course.html
     *
     * @param url URL to treat.
     * @return Last file without params.
     */
    getLastFileWithoutParams(url: string): string {
        let filename = url.substr(url.lastIndexOf('/') + 1);
        if (filename.indexOf('?') != -1) {
            filename = filename.substr(0, filename.indexOf('?'));
        }

        return filename;
    }

    /**
     * Get the protocol from a URL.
     * E.g. http://www.google.com returns 'http'.
     *
     * @param url URL to treat.
     * @return Protocol, undefined if no protocol found.
     */
    getUrlProtocol(url: string): string {
        if (!url) {
            return;
        }

        const matches = url.match(/^([^\/:\.\?]*):\/\//);
        if (matches && matches[1]) {
            return matches[1];
        }
    }

    /**
     * Get the scheme from a URL. Please notice that, if a URL has protocol, it will return the protocol.
     * E.g. javascript:doSomething() returns 'javascript'.
     *
     * @param url URL to treat.
     * @return Scheme, undefined if no scheme found.
     */
    getUrlScheme(url: string): string {
        if (!url) {
            return;
        }

        const matches = url.match(/^([a-z][a-z0-9+\-.]*):/);
        if (matches && matches[1]) {
            return matches[1];
        }
    }

    /*
     * Gets a username from a URL like: user@mysite.com.
     *
     * @param url URL to treat.
     * @return Username. Undefined if no username found.
     */
    getUsernameFromUrl(url: string): string {
        if (url.indexOf('@') > -1) {
            // Get URL without protocol.
            const withoutProtocol = url.replace(/^[^?@\/]*:\/\//, ''),
                matches = withoutProtocol.match(/[^@]*/);

            // Make sure that @ is at the start of the URL, not in a param at the end.
            if (matches && matches.length && !matches[0].match(/[\/|?]/)) {
                return matches[0];
            }
        }
    }

    /**
     * Returns if a URL has any protocol (not a relative URL).
     *
     * @param url The url to test against the pattern.
     * @return Whether the url is absolute.
     */
    isAbsoluteURL(url: string): boolean {
        return /^[^:]{2,}:\/\//i.test(url) || /^(tel:|mailto:|geo:)/.test(url);
    }

    /**
     * Returns if a URL is downloadable: plugin file OR theme/image.php OR gravatar.
     *
     * @param url The URL to test.
     * @return Whether the URL is downloadable.
     */
    isDownloadableUrl(url: string): boolean {
        return this.isPluginFileUrl(url) || this.isThemeImageUrl(url) || this.isGravatarUrl(url);
    }

    /**
     * Returns if a URL is a gravatar URL.
     *
     * @param url The URL to test.
     * @return Whether the URL is a gravatar URL.
     */
    isGravatarUrl(url: string): boolean {
        return url && url.indexOf('gravatar.com/avatar') !== -1;
    }

    /**
     * Check if a URL uses http or https protocol.
     *
     * @param url The url to test.
     * @return Whether the url uses http or https protocol.
     */
    isHttpURL(url: string): boolean {
        return /^https?\:\/\/.+/i.test(url);
    }

    /**
     * Check whether an URL belongs to a local file.
     *
     * @param url URL to check.
     * @return Whether the URL belongs to a local file.
     */
    isLocalFileUrl(url: string): boolean {
        const urlParts = CoreUrl.parse(url);

        return this.isLocalFileUrlScheme(urlParts.protocol, urlParts.domain);
    }

    /**
     * Check whether a URL scheme belongs to a local file.
     *
     * @param scheme Scheme to check.
     * @param domain The domain. Needed because in Android the WebView scheme is http.
     * @return Whether the scheme belongs to a local file.
     */
    isLocalFileUrlScheme(scheme: string, domain: string): boolean {
        if (scheme) {
            scheme = scheme.toLowerCase();
        }

        return scheme == 'cdvfile' ||
                scheme == 'file' ||
                scheme == 'filesystem' ||
                scheme == CoreConfigConstants.ioswebviewscheme;
    }

    /**
     * Returns if a URL is a pluginfile URL.
     *
     * @param url The URL to test.
     * @return Whether the URL is a pluginfile URL.
     */
    isPluginFileUrl(url: string): boolean {
        return url && url.indexOf('/pluginfile.php') !== -1;
    }

    /**
     * Returns if a URL is a theme image URL.
     *
     * @param url The URL to test.
     * @return Whether the URL is a theme image URL.
     */
    isThemeImageUrl(url: string): boolean {
        return url && url.indexOf('/theme/image.php') !== -1;
    }

    /**
     * Remove protocol and www from a URL.
     *
     * @param url URL to treat.
     * @return Treated URL.
     */
    removeProtocolAndWWW(url: string): string {
        // Remove protocol.
        url = url.replace(/.*?:\/\//g, '');
        // Remove www.
        url = url.replace(/^www./, '');

        return url;
    }

    /**
     * Remove the parameters from a URL, returning the URL without them.
     *
     * @param url URL to treat.
     * @return URL without params.
     */
    removeUrlParams(url: string): string {
        const matches = url.match(/^[^\?]+/);

        return matches && matches[0];
    }

    /**
     * Modifies a pluginfile URL to use the default pluginfile script instead of the webservice one.
     *
     * @param url The url to be fixed.
     * @param siteUrl The URL of the site the URL belongs to.
     * @return Modified URL.
     */
    unfixPluginfileURL(url: string, siteUrl?: string): string {
        if (!url) {
            return '';
        }

        url = url.replace(/&amp;/g, '&');

        // It site URL is supplied, check if the URL belongs to the site.
        if (siteUrl && url.indexOf(this.textUtils.addEndingSlash(siteUrl)) !== 0) {
            return url;
        }

        // Not a pluginfile URL. Treat webservice/pluginfile case.
        url = url.replace(/\/webservice\/pluginfile\.php\//, '/pluginfile.php/');

        // Make sure the URL doesn't contain the token.
        url.replace(/([?&])token=[^&]*&?/, '$1');

        return url;
    }
}

export class CoreUrlUtils extends makeSingleton(CoreUrlUtilsProvider) {}
