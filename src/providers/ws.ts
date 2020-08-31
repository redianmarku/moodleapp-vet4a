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
import { Platform } from 'ionic-angular';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { FileTransfer, FileUploadOptions } from '@ionic-native/file-transfer';
import { CoreAppProvider } from './app';
import { CoreFileProvider } from './file';
import { CoreLoggerProvider } from './logger';
import { CoreMimetypeUtilsProvider } from './utils/mimetype';
import { CoreTextUtilsProvider } from './utils/text';
import { CoreConstants } from '@core/constants';
import { Md5 } from 'ts-md5/dist/md5';
import { CoreInterceptor } from '@classes/interceptor';
import { makeSingleton } from '@singletons/core.singletons';
import { Observable } from 'rxjs/Observable';
import { CoreNativeToAngularHttpResponse } from '@classes/native-to-angular-http';

/**
 * PreSets accepted by the WS call.
 */
export interface CoreWSPreSets {
    /**
     * The site URL.
     */
    siteUrl: string;

    /**
     * The Webservice token.
     */
    wsToken: string;

    /**
     * Defaults to true. Set to false when the expected response is null.
     */
    responseExpected?: boolean;

    /**
     * Defaults to 'object'. Use it when you expect a type that's not an object|array.
     */
    typeExpected?: string;

    /**
     * Defaults to false. Clean multibyte Unicode chars from data.
     */
    cleanUnicode?: boolean;
}

/**
 * PreSets accepted by AJAX WS calls.
 */
export interface CoreWSAjaxPreSets {
    /**
     * The site URL.
     */
    siteUrl: string;

    /**
     * Defaults to true. Set to false when the expected response is null.
     */
    responseExpected?: boolean;

    /**
     * Whether to use the no-login endpoint instead of the normal one. Use it for requests that don't require authentication.
     */
    noLogin?: boolean;

    /**
     * Whether to send the parameters via GET. Only if noLogin is true.
     */
    useGet?: boolean;
}

/**
 * Options for HTTP requests.
 */
export type HttpRequestOptions = {
    /**
     * The HTTP method.
     */
    method: string;

    /**
     * Payload to send to the server. Only applicable on post, put or patch methods.
     */
    data?: any;

    /**
     * Query params to be appended to the URL (only applicable on get, head, delete, upload or download methods).
     */
    params?: any;

    /**
     * Response type. Defaults to json.
     */
    responseType?: 'json' | 'text' | 'arraybuffer' | 'blob';

    /**
     * Timeout for the request in seconds. If undefined, the default value will be used. If null, no timeout.
     */
    timeout?: number | null;

    /**
     * Serializer to use. Defaults to 'urlencoded'. Only for mobile environments.
     */
    serializer?: string;

    /**
     * Whether to follow redirects. Defaults to true. Only for mobile environments.
     */
    followRedirect?: boolean;

    /**
     * Headers. Only for mobile environments.
     */
    headers?: {[name: string]: string};

    /**
     * File paths to use for upload or download. Only for mobile environments.
     */
    filePath?: string;

    /**
     * Name to use during upload. Only for mobile environments.
     */
    name?: string;
};

/**
 * This service allows performing WS calls and download/upload files.
 */
@Injectable()
export class CoreWSProvider {
    protected logger;
    protected mimeTypeCache = {}; // A "cache" to store file mimetypes to prevent performing too many HEAD requests.
    protected ongoingCalls = {};
    protected retryCalls = [];
    protected retryTimeout = 0;

    constructor(protected http: HttpClient,
            protected translate: TranslateService,
            protected appProvider: CoreAppProvider,
            protected textUtils: CoreTextUtilsProvider,
            protected fileProvider: CoreFileProvider,
            protected fileTransfer: FileTransfer,
            protected mimeUtils: CoreMimetypeUtilsProvider,
            logger: CoreLoggerProvider,
            platform: Platform) {
        this.logger = logger.getInstance('CoreWSProvider');

        platform.ready().then(() => {
            if (this.appProvider.isIOS()) {
                (<any> cordova).plugin.http.setHeader('User-Agent', navigator.userAgent);
            }
        });
    }

    /**
     * Adds the call data to an special queue to be processed when retrying.
     *
     * @param method The WebService method to be called.
     * @param siteUrl Complete site url to perform the call.
     * @param ajaxData Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Deferred promise resolved with the response data in success and rejected with the error message
     *         if it fails.
     */
    protected addToRetryQueue(method: string, siteUrl: string, ajaxData: any, preSets: CoreWSPreSets): Promise<any> {
        const call: any = {
            method: method,
            siteUrl: siteUrl,
            ajaxData: ajaxData,
            preSets: preSets,
            deferred: {}
        };

        call.deferred.promise = new Promise((resolve, reject): void => {
            call.deferred.resolve = resolve;
            call.deferred.reject = reject;
        });

        this.retryCalls.push(call);

        return call.deferred.promise;
    }

    /**
     * A wrapper function for a moodle WebService call.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method. It's recommended to call convertValuesToString before passing the data.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected if it fails.
     */
    call(method: string, data: any, preSets: CoreWSPreSets): Promise<any> {

        let siteUrl;

        if (!preSets) {
            return Promise.reject(this.createFakeWSError('core.unexpectederror', true));
        } else if (!this.appProvider.isOnline()) {
            return Promise.reject(this.createFakeWSError('core.networkerrormsg', true));
        }

        preSets.typeExpected = preSets.typeExpected || 'object';
        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        data = Object.assign({}, data); // Create a new object so the changes don't affect the original data.
        data.wsfunction = method;
        data.wstoken = preSets.wsToken;
        siteUrl = preSets.siteUrl + '/webservice/rest/server.php?moodlewsrestformat=json';

        // There are some ongoing retry calls, wait for timeout.
        if (this.retryCalls.length > 0) {
            this.logger.warn('Calls locked, trying later...');

            return this.addToRetryQueue(method, siteUrl, data, preSets);
        } else {
            return this.performPost(method, siteUrl, data, preSets);
        }
    }

    /**
     * Call a Moodle WS using the AJAX API. Please use it if the WS layer is not an option.
     * It uses a cache to prevent duplicate requests.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information. Only some
     * @return Promise resolved with the response data in success and rejected with an object containing:
     *         - error: Error message.
     *         - errorcode: Error code returned by the site (if any).
     *         - available: 0 if unknown, 1 if available, -1 if not available.
     */
    callAjax(method: string, data: any, preSets: CoreWSAjaxPreSets): Promise<any> {
        const cacheParams = {
            methodname: method,
            args: data,
        };

        let promise = this.getPromiseHttp('ajax', preSets.siteUrl, cacheParams);

        if (!promise) {
            promise = this.performAjax(method, data, preSets);
            promise = this.setPromiseHttp(promise, 'ajax', preSets.siteUrl, cacheParams);
        }

        return promise;
    }

    /**
     * Converts an objects values to strings where appropriate.
     * Arrays (associative or otherwise) will be maintained, null values will be removed.
     *
     * @param data The data that needs all the non-object values set to strings.
     * @param stripUnicode If Unicode long chars need to be stripped.
     * @return The cleaned object or null if some strings becomes empty after stripping Unicode.
     */
    convertValuesToString(data: any, stripUnicode?: boolean): any {
        const result: any = Array.isArray(data) ? [] : {};

        for (const key in data) {
            let value = data[key];

            if (value == null) {
                // Skip null or undefined value.
                continue;
            } else if (typeof value == 'object') {
                // Object or array.
                value = this.convertValuesToString(value, stripUnicode);
                if (value == null) {
                    return null;
                }
            } else if (typeof value == 'string') {
                if (stripUnicode) {
                    const stripped = this.textUtils.stripUnicode(value);
                    if (stripped != value && stripped.trim().length == 0) {
                        return null;
                    }
                    value = stripped;
                }
            } else if (typeof value == 'boolean') {
                /* Moodle does not allow "true" or "false" in WS parameters, only in POST parameters.
                   We've been using "true" and "false" for WS settings "filter" and "fileurl",
                   we keep it this way to avoid changing cache keys. */
                if (key == 'moodlewssettingfilter' || key == 'moodlewssettingfileurl') {
                    value = value ? 'true' : 'false';
                } else {
                    value = value ? '1' : '0';
                }
            } else if (typeof value == 'number') {
                value = String(value);
            } else {
                // Unknown type.
                continue;
            }

            if (Array.isArray(result)) {
                result.push(value);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Create a "fake" WS error for local errors.
     *
     * @param message The message to include in the error.
     * @param needsTranslate If the message needs to be translated.
     * @param translateParams Translation params, if needed.
     * @return Fake WS error.
     */
    createFakeWSError(message: string, needsTranslate?: boolean, translateParams?: {}): CoreWSError {
        if (needsTranslate) {
            message = this.translate.instant(message, translateParams);
        }

        return {
            message: message
        };
    }

    /**
     * Downloads a file from Moodle using Cordova File API.
     *
     * @param url Download url.
     * @param path Local path to store the file.
     * @param addExtension True if extension need to be added to the final path.
     * @param onProgress Function to call on progress.
     * @return Promise resolved with the downloaded file.
     */
    downloadFile(url: string, path: string, addExtension?: boolean, onProgress?: (event: ProgressEvent) => any): Promise<any> {
        this.logger.debug('Downloading file', url, path, addExtension);

        if (!this.appProvider.isOnline()) {
            return Promise.reject(this.translate.instant('core.networkerrormsg'));
        }

        // Use a tmp path to download the file and then move it to final location.
        // This is because if the download fails, the local file is deleted.
        const tmpPath = path + '.tmp';

        // Create the tmp file as an empty file.
        return this.fileProvider.createFile(tmpPath).then((fileEntry) => {
            const transfer = this.fileTransfer.create();
            transfer.onProgress(onProgress);

            return transfer.download(url, fileEntry.toURL(), true).then(() => {
                let promise;

                if (addExtension) {
                    const ext = this.mimeUtils.getFileExtension(path);

                    // Google Drive extensions will be considered invalid since Moodle usually converts them.
                    if (!ext || ext == 'gdoc' || ext == 'gsheet' || ext == 'gslides' || ext == 'gdraw' || ext == 'php') {
                        // Not valid, get the file's mimetype.
                        promise = this.getRemoteFileMimeType(url).then((mime) => {
                            if (mime) {
                                const remoteExt = this.mimeUtils.getExtension(mime, url);
                                // If the file is from Google Drive, ignore mimetype application/json.
                                if (remoteExt && (!ext || mime != 'application/json')) {
                                    if (ext) {
                                        // Remove existing extension since we will use another one.
                                        path = this.mimeUtils.removeExtension(path);
                                    }
                                    path += '.' + remoteExt;

                                    return remoteExt;
                                }
                            }

                            return ext;
                        });
                    } else {
                        promise = Promise.resolve(ext);
                    }
                } else {
                    promise = Promise.resolve('');
                }

                return promise.then((extension) => {
                    return this.fileProvider.moveFile(tmpPath, path).then((movedEntry) => {
                        // Save the extension.
                        movedEntry.extension = extension;
                        movedEntry.path = path;
                        this.logger.debug(`Success downloading file ${url} to ${path} with extension ${extension}`);

                        return movedEntry;
                    });
                });
            });
        }).catch((err) => {
            this.logger.error(`Error downloading ${url} to ${path}`, err);

            return Promise.reject(err);
        });
    }

    /**
     * Get a promise from the cache.
     *
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     */
    protected getPromiseHttp(method: string, url: string, params?: any): any {
        const queueItemId = this.getQueueItemId(method, url, params);
        if (typeof this.ongoingCalls[queueItemId] != 'undefined') {
            return this.ongoingCalls[queueItemId];
        }

        return false;
    }

    /**
     * Perform a HEAD request to get the mimetype of a remote file.
     *
     * @param url File URL.
     * @param ignoreCache True to ignore cache, false otherwise.
     * @return Promise resolved with the mimetype or '' if failure.
     */
    getRemoteFileMimeType(url: string, ignoreCache?: boolean): Promise<string> {
        if (this.mimeTypeCache[url] && !ignoreCache) {
            return Promise.resolve(this.mimeTypeCache[url]);
        }

        return this.performHead(url).then((response) => {
            let mimeType = response.headers.get('Content-Type');
            if (mimeType) {
                // Remove "parameters" like charset.
                mimeType = mimeType.split(';')[0];
            }
            this.mimeTypeCache[url] = mimeType;

            return mimeType || '';
        }).catch(() => {
            // Error, resolve with empty mimetype.
            return '';
        });
    }

    /**
     * Perform a HEAD request to get the size of a remote file.
     *
     * @param url File URL.
     * @return Promise resolved with the size or -1 if failure.
     */
    getRemoteFileSize(url: string): Promise<number> {
        return this.performHead(url).then((response) => {
            const size = parseInt(response.headers.get('Content-Length'), 10);

            if (size) {
                return size;
            }

            return -1;
        }).catch(() => {
            // Error, return -1.
            return -1;
        });
    }

    /**
     * Get a request timeout based on the network connection.
     *
     * @return Timeout in ms.
     */
    getRequestTimeout(): number {
        return this.appProvider.isNetworkAccessLimited() ? CoreConstants.WS_TIMEOUT : CoreConstants.WS_TIMEOUT_WIFI;
    }

    /**
     * Get the unique queue item id of the cache for a HTTP request.
     *
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     * @return Queue item ID.
     */
    protected getQueueItemId(method: string, url: string, params?: any): string {
        if (params) {
            url += '###' + CoreInterceptor.serialize(params);
        }

        return method + '#' + Md5.hashAsciiStr(url);
    }

    /**
     * Call a Moodle WS using the AJAX API.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information. Only some
     * @return Promise resolved with the response data in success and rejected with an object containing:
     *         - error: Error message.
     *         - errorcode: Error code returned by the site (if any).
     *         - available: 0 if unknown, 1 if available, -1 if not available.
     */
    protected performAjax(method: string, data: any, preSets: CoreWSAjaxPreSets): Promise<any> {

        let promise;

        if (typeof preSets.siteUrl == 'undefined') {
            return rejectWithError(this.createFakeWSError('core.unexpectederror', true));
        } else if (!this.appProvider.isOnline()) {
            return rejectWithError(this.createFakeWSError('core.networkerrormsg', true));
        }

        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        const script = preSets.noLogin ? 'service-nologin.php' : 'service.php';
        const ajaxData = [{
            index: 0,
            methodname: method,
            args: this.convertValuesToString(data)
        }];

        // The info= parameter has no function. It is just to help with debugging.
        // We call it info to match the parameter name use by Moodle's AMD ajax module.
        let siteUrl = preSets.siteUrl + '/lib/ajax/' + script + '?info=' + method;

        if (preSets.noLogin && preSets.useGet) {
            // Send params using GET.
            siteUrl += '&args=' + encodeURIComponent(JSON.stringify(ajaxData));

            promise = this.sendHTTPRequest(siteUrl, {
                method: 'get',
            });
        } else {
            promise = this.sendHTTPRequest(siteUrl, {
                method: 'post',
                data: ajaxData,
                serializer: 'json',
            });
        }

        return promise.then((response: HttpResponse<any>) => {
            let data = response.body;

            // Some moodle web services return null.
            // If the responseExpected value is set then so long as no data is returned, we create a blank object.
            if (!data && !preSets.responseExpected) {
                data = [{}];
            }

            // Check if error. Ajax layer should always return an object (if error) or an array (if success).
            if (!data || typeof data != 'object') {
                return rejectWithError(this.createFakeWSError('core.serverconnection', true));
            } else if (data.error) {
                return rejectWithError(data);
            }

            // Get the first response since only one request was done.
            data = data[0];

            if (data.error) {
                return rejectWithError(data.exception);
            }

            return data.data;
        }, (data) => {
            const available = data.status == 404 ? -1 : 0;

            return rejectWithError(this.createFakeWSError('core.serverconnection', true), available);
        });

        // Convenience function to return an error.
        function rejectWithError(exception: any, available?: number): Promise<never> {
            if (typeof available == 'undefined') {
                if (exception.errorcode) {
                    available = exception.errorcode == 'invalidrecord' ? -1 : 1;
                } else {
                    available = 0;
                }
            }

            exception.available = available;

            return Promise.reject(exception);
        }
    }

    /**
     * Perform a HEAD request and save the promise while waiting to be resolved.
     *
     * @param url URL to perform the request.
     * @return Promise resolved with the response.
     */
    performHead(url: string): Promise<HttpResponse<any>> {
        let promise = this.getPromiseHttp('head', url);

        if (!promise) {
            promise = this.sendHTTPRequest(url, {
                method: 'head',
                responseType: 'text',
            });

            promise = this.setPromiseHttp(promise, 'head', url);
        }

        return promise;
    }

    /**
     * Perform the post call and save the promise while waiting to be resolved.
     *
     * @param method The WebService method to be called.
     * @param siteUrl Complete site url to perform the call.
     * @param ajaxData Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected with CoreWSError if it fails.
     */
    performPost(method: string, siteUrl: string, ajaxData: any, preSets: CoreWSPreSets): Promise<any> {
        const options = {};

        // This is done because some returned values like 0 are treated as null if responseType is json.
        if (preSets.typeExpected == 'number' || preSets.typeExpected == 'boolean' || preSets.typeExpected == 'string') {
            // Avalaible values are: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/responseType
            options['responseType'] = 'text';
        }

        // We add the method name to the URL purely to help with debugging.
        // This duplicates what is in the ajaxData, but that does no harm.
        // POST variables take precedence over GET.
        const requestUrl = siteUrl + '&wsfunction=' + method;

        // Perform the post request.
        const promise = this.http.post(requestUrl, ajaxData, options).timeout(this.getRequestTimeout()).toPromise();

        return promise.then((data: any) => {

            // Some moodle web services return null.
            // If the responseExpected value is set to false, we create a blank object if the response is null.
            if (!data && !preSets.responseExpected) {
                data = {};
            }

            if (!data) {
                return Promise.reject(this.createFakeWSError('core.serverconnection', true));
            } else if (typeof data != preSets.typeExpected) {
                // If responseType is text an string will be returned, parse before returning.
                if (typeof data == 'string') {
                    if (preSets.typeExpected == 'number') {
                        data = Number(data);
                        if (isNaN(data)) {
                            this.logger.warn(`Response expected type "${preSets.typeExpected}" cannot be parsed to number`);

                            return Promise.reject(this.createFakeWSError('core.errorinvalidresponse', true));
                        }
                    } else if (preSets.typeExpected == 'boolean') {
                        if (data === 'true') {
                            data = true;
                        } else if (data === 'false') {
                            data = false;
                        } else {
                            this.logger.warn(`Response expected type "${preSets.typeExpected}" is not true or false`);

                            return Promise.reject(this.createFakeWSError('core.errorinvalidresponse', true));
                        }
                    } else {
                        this.logger.warn('Response of type "' + typeof data + `" received, expecting "${preSets.typeExpected}"`);

                        return Promise.reject(this.createFakeWSError('core.errorinvalidresponse', true));
                    }
                } else {
                    this.logger.warn('Response of type "' + typeof data + `" received, expecting "${preSets.typeExpected}"`);

                    return Promise.reject(this.createFakeWSError('core.errorinvalidresponse', true));
                }
            }

            if (typeof data.exception !== 'undefined') {
                // Special debugging for site plugins, otherwise it's hard to debug errors if the data is cached.
                if (method == 'tool_mobile_get_content') {
                    this.logger.error('Error calling WS', method, data);
                }

                return Promise.reject(data);
            }

            if (typeof data.debuginfo != 'undefined') {
                return Promise.reject(this.createFakeWSError('Error. ' + data.message));
            }

            return data;
        }, (error) => {
            // If server has heavy load, retry after some seconds.
            if (error.status == 429) {
                const retryPromise = this.addToRetryQueue(method, siteUrl, ajaxData, preSets);

                // Only process the queue one time.
                if (this.retryTimeout == 0) {
                    this.retryTimeout = parseInt(error.headers.get('Retry-After'), 10) || 5;
                    this.logger.warn(`${error.statusText}. Retrying in ${this.retryTimeout} seconds. ` +
                        `${this.retryCalls.length} calls left.`);

                    setTimeout(() => {
                        this.logger.warn(`Retrying now with ${this.retryCalls.length} calls to process.`);
                        // Finish timeout.
                        this.retryTimeout = 0;
                        this.processRetryQueue();
                    }, this.retryTimeout * 1000);
                } else {
                    this.logger.warn('Calls locked, trying later...');
                }

                return retryPromise;
            }

            return Promise.reject(this.createFakeWSError('core.serverconnection', true));
        });
    }

    /**
     * Retry all requests in the queue.
     * This function uses recursion in order to add a delay between requests to reduce stress.
     */
    protected processRetryQueue(): void {
        if (this.retryCalls.length > 0 && this.retryTimeout == 0) {
            const call = this.retryCalls.shift();
            // Add a delay between calls.
            setTimeout(() => {
                call.deferred.resolve(this.performPost(call.method, call.siteUrl, call.ajaxData, call.preSets));
                this.processRetryQueue();
            }, 200);
        } else {
            this.logger.warn(`Retry queue has stopped with ${this.retryCalls.length} calls and ${this.retryTimeout} timeout secs.`);
        }
    }

    /**
     * Save promise on the cache.
     *
     * @param promise Promise to be saved.
     * @param method Method of the HTTP request.
     * @param url Base URL of the HTTP request.
     * @param params Params of the HTTP request.
     * @return The promise saved.
     */
    protected setPromiseHttp(promise: Promise<any>, method: string, url: string, params?: any): Promise<any> {
        const queueItemId = this.getQueueItemId(method, url, params);
        let timeout;

        this.ongoingCalls[queueItemId] = promise;

        // HTTP not finished, but we should delete the promise after timeout.
        timeout = setTimeout(() => {
            delete this.ongoingCalls[queueItemId];
        }, this.getRequestTimeout());

        // HTTP finished, delete from ongoing.
        return promise.finally(() => {
            delete this.ongoingCalls[queueItemId];

            clearTimeout(timeout);
        });
    }

    /**
     * A wrapper function for a synchronous Moodle WebService call.
     * Warning: This function should only be used if synchronous is a must. It's recommended to use call.
     *
     * @param method The WebService method to be called.
     * @param data Arguments to pass to the method.
     * @param preSets Extra settings and information.
     * @return Promise resolved with the response data in success and rejected with the error message if it fails.
     * @return Request response. If the request fails, returns an object with 'error'=true and 'message' properties.
     */
    syncCall(method: string, data: any, preSets: CoreWSPreSets): any {
        const errorResponse = {
                error: true,
                message: ''
            };
        let siteUrl,
            xhr;

        if (!preSets) {
            errorResponse.message = this.translate.instant('core.unexpectederror');

            return errorResponse;
        } else if (!this.appProvider.isOnline()) {
            errorResponse.message = this.translate.instant('core.networkerrormsg');

            return errorResponse;
        }

        preSets.typeExpected = preSets.typeExpected || 'object';
        if (typeof preSets.responseExpected == 'undefined') {
            preSets.responseExpected = true;
        }

        data = this.convertValuesToString(data || {}, preSets.cleanUnicode);
        if (data == null) {
            // Empty cleaned text found.
            errorResponse.message = this.translate.instant('core.unicodenotsupportedcleanerror');

            return errorResponse;
        }

        data.wsfunction = method;
        data.wstoken = preSets.wsToken;
        siteUrl = preSets.siteUrl + '/webservice/rest/server.php?moodlewsrestformat=json';

        // Serialize data.
        data = CoreInterceptor.serialize(data);

        // Perform sync request using XMLHttpRequest.
        xhr = new (<any> window).XMLHttpRequest();
        xhr.open('post', siteUrl, false);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=utf-8');

        xhr.send(data);

        // Get response.
        data = ('response' in xhr) ? xhr.response : xhr.responseText;

        // Check status.
        const status = Math.max(xhr.status === 1223 ? 204 : xhr.status, 0);
        if (status < 200 || status >= 300) {
            // Request failed.
            errorResponse.message = data;

            return errorResponse;
        }

        // Treat response.
        data = this.textUtils.parseJSON(data);

        // Some moodle web services return null.
        // If the responseExpected value is set then so long as no data is returned, we create a blank object.
        if ((!data || !data.data) && !preSets.responseExpected) {
            data = {};
        }

        if (!data) {
            errorResponse.message = this.translate.instant('core.serverconnection');
        } else if (typeof data != preSets.typeExpected) {
            this.logger.warn('Response of type "' + typeof data + '" received, expecting "' + preSets.typeExpected + '"');
            errorResponse.message = this.translate.instant('core.errorinvalidresponse');
        }

        if (typeof data.exception != 'undefined' || typeof data.debuginfo != 'undefined') {
            errorResponse.message = data.message;
        }

        if (errorResponse.message !== '') {
            return errorResponse;
        }

        return data;
    }

    /*
     * Uploads a file.
     *
     * @param filePath File path.
     * @param options File upload options.
     * @param preSets Must contain siteUrl and wsToken.
     * @param onProgress Function to call on progress.
     * @return Promise resolved when uploaded.
     */
    uploadFile(filePath: string, options: CoreWSFileUploadOptions, preSets: CoreWSPreSets,
            onProgress?: (event: ProgressEvent) => any): Promise<any> {
        this.logger.debug(`Trying to upload file: ${filePath}`);

        if (!filePath || !options || !preSets) {
            return Promise.reject(null);
        }

        if (!this.appProvider.isOnline()) {
            return Promise.reject(this.translate.instant('core.networkerrormsg'));
        }

        const uploadUrl = preSets.siteUrl + '/webservice/upload.php',
            transfer = this.fileTransfer.create();

        transfer.onProgress(onProgress);

        options.httpMethod = 'POST';
        options.params = {
            token: preSets.wsToken,
            filearea: options.fileArea || 'draft',
            itemid: options.itemId || 0
        };
        options.chunkedMode = false;
        options.headers = {
            Connection: 'close'
        };

        return transfer.upload(filePath, uploadUrl, options, true).then((success) => {
            const data = this.textUtils.parseJSON(success.response, null,
                    this.logger.error.bind(this.logger, 'Error parsing response from upload', success.response));
            if (data === null) {
                return Promise.reject(this.translate.instant('core.errorinvalidresponse'));
            }

            if (!data) {
                return Promise.reject(this.translate.instant('core.serverconnection'));
            } else if (typeof data != 'object') {
                this.logger.warn('Upload file: Response of type "' + typeof data + '" received, expecting "object"');

                return Promise.reject(this.translate.instant('core.errorinvalidresponse'));
            }

            if (typeof data.exception !== 'undefined') {
                return Promise.reject(data.message);
            } else if (data && typeof data.error !== 'undefined') {
                return Promise.reject(data.error);
            } else if (data[0] && typeof data[0].error !== 'undefined') {
                return Promise.reject(data[0].error);
            }

            // We uploaded only 1 file, so we only return the first file returned.
            this.logger.debug('Successfully uploaded file', filePath);

            return data[0];
        }).catch((error) => {
            this.logger.error('Error while uploading file', filePath, error);

            return Promise.reject(this.translate.instant('core.errorinvalidresponse'));
        });
    }

    /**
     * Perform an HTTP request requesting for a text response.
     *
     * @param  url Url to get.
     * @return Resolved with the text when done.
     */
    async getText(url: string): Promise<string> {
        // Fetch the URL content.
        const options: HttpRequestOptions = {
            method: 'get',
            responseType: 'text',
        };

        const response = await this.sendHTTPRequest(url, options);

        const content = response.body;

        if (typeof content !== 'string') {
            throw 'Error reading content';
        }

        return content;
    }

    /**
     * Send an HTTP request. In mobile devices it will use the cordova plugin.
     *
     * @param url URL of the request.
     * @param options Options for the request.
     * @return Promise resolved with the response.
     */
    async sendHTTPRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse<any>> {

        // Set default values.
        options.responseType = options.responseType || 'json';
        options.timeout = typeof options.timeout == 'undefined' ? this.getRequestTimeout() : options.timeout;

        if (this.appProvider.isIOS()) {
            // Use the cordova plugin.
            if (url.indexOf('file://') === 0) {
                // We cannot load local files using the http native plugin. Use file provider instead.
                const format = options.responseType == 'json' ? CoreFileProvider.FORMATJSON : CoreFileProvider.FORMATTEXT;

                const content = await this.fileProvider.readFile(url, format);

                return new HttpResponse({
                    body: content,
                    headers: null,
                    status: 200,
                    statusText: 'OK',
                    url: url
                });
            }

            return new Promise<HttpResponse<any>>((resolve, reject): void => {
                // We cannot use Ionic Native plugin because it doesn't have the sendRequest method.
                (<any> cordova).plugin.http.sendRequest(url, options, (response) => {
                    resolve(new CoreNativeToAngularHttpResponse(response));
                }, reject);
            });
        } else {
            let observable: Observable<any>;

            // Use Angular's library.
            switch (options.method) {
                case 'get':
                    observable = this.http.get(url, {
                        headers: options.headers,
                        params: options.params,
                        observe: 'response',
                        responseType: <any> options.responseType,
                    });
                    break;

                case 'post':
                    if (options.serializer == 'json') {
                        options.data = JSON.stringify(options.data);
                    }

                    observable = this.http.post(url, options.data, {
                        headers: options.headers,
                        observe: 'response',
                        responseType: <any> options.responseType,
                    });
                    break;

                case 'head':
                    observable = this.http.head(url, {
                        headers: options.headers,
                        observe: 'response',
                        responseType: <any> options.responseType
                    });
                    break;

                default:
                    return Promise.reject('Method not implemented yet.');
            }

            if (options.timeout) {
                observable = observable.timeout(options.timeout);
            }

            return observable.toPromise();
        }
    }
}

export class CoreWS extends makeSingleton(CoreWSProvider) {}

/**
 * Error returned by a WS call.
 */
export interface CoreWSError {
    /**
     * The error message.
     */
    message: string;

    /**
     * Name of the exception. Undefined for local errors (fake WS errors).
     */
    exception?: string;

    /**
     * The error code. Undefined for local errors (fake WS errors).
     */
    errorcode?: string;
}

/**
 * File upload options.
 */
export interface CoreWSFileUploadOptions extends FileUploadOptions {
    /**
     * The file area where to put the file. By default, 'draft'.
     */
    fileArea?: string;

    /**
     * Item ID of the area where to put the file. By default, 0.
     */
    itemId?: number;
}

/**
 * Structure of warnings returned by WS.
 */
export type CoreWSExternalWarning = {
    /**
     * Item.
     */
    item?: string;

    /**
     * Item id.
     */
    itemid?: number;

    /**
     * The warning code can be used by the client app to implement specific behaviour.
     */
    warningcode: string;

    /**
     * Untranslated english message to explain the warning.
     */
    message: string;

};

/**
 * Structure of files returned by WS.
 */
export type CoreWSExternalFile = {
    /**
     * File name.
     */
    filename?: string;

    /**
     * File path.
     */
    filepath?: string;

    /**
     * File size.
     */
    filesize?: number;

    /**
     * Downloadable file url.
     */
    fileurl?: string;

    /**
     * Time modified.
     */
    timemodified?: number;

    /**
     * File mime type.
     */
    mimetype?: string;

    /**
     * Whether is an external file.
     */
    isexternalfile?: number;

    /**
     * The repository type for external files.
     */
    repositorytype?: string;

};

/**
 * Data returned by date_exporter.
 */
export type CoreWSDate = {
    seconds: number; // Seconds.
    minutes: number; // Minutes.
    hours: number; // Hours.
    mday: number; // Mday.
    wday: number; // Wday.
    mon: number; // Mon.
    year: number; // Year.
    yday: number; // Yday.
    weekday: string; // Weekday.
    month: string; // Month.
    timestamp: number; // Timestamp.
};
