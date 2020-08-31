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

import { Injectable, NgZone } from '@angular/core';
import { Network } from '@ionic-native/network';
import { CoreAppProvider, CoreAppSchema } from './app';
import { CoreEventsProvider } from './events';
import { CoreFileProvider } from './file';
import { CoreInitDelegate } from './init';
import { CoreLoggerProvider } from './logger';
import { CorePluginFileDelegate } from './plugin-file-delegate';
import { CoreSitesProvider, CoreSiteSchema } from './sites';
import { CoreWSProvider, CoreWSExternalFile } from './ws';
import { CoreDomUtilsProvider } from './utils/dom';
import { CoreMimetypeUtilsProvider } from './utils/mimetype';
import { CoreTextUtilsProvider } from './utils/text';
import { CoreTimeUtilsProvider } from './utils/time';
import { CoreUrlUtilsProvider } from './utils/url';
import { CoreUtilsProvider } from './utils/utils';
import { SQLiteDB } from '@classes/sqlitedb';
import { CoreConstants } from '@core/constants';
import { Md5 } from 'ts-md5/dist/md5';
import { makeSingleton } from '@singletons/core.singletons';

/**
 * Entry from filepool.
 */
export interface CoreFilepoolFileEntry {
    /**
     * The fileId to identify the file.
     */
    fileId?: string;

    /**
     * File's URL.
     */
    url?: string;

    /**
     * File's revision.
     */
    revision?: number;

    /**
     * File's timemodified.
     */
    timemodified?: number;

    /**
     * 1 if file is stale (needs to be updated), 0 otherwise.
     */
    stale?: number;

    /**
     * Timestamp when this file was downloaded.
     */
    downloadTime?: number;

    /**
     * 1 if it's a external file (from an external repository), 0 otherwise.
     */
    isexternalfile?: number;

    /**
     * Type of the repository this file belongs to.
     */
    repositorytype?: string;

    /**
     * File's path.
     */
    path?: string;

    /**
     * File's extension.
     */
    extension?: string;
}

/**
 * Entry from the file's queue.
 */
export interface CoreFilepoolQueueEntry {
    /**
     * The site the file belongs to.
     */
    siteId?: string;

    /**
     * The fileId to identify the file.
     */
    fileId?: string;

    /**
     * Timestamp when the file was added to the queue.
     */
    added?: number;

    /**
     * The priority of the file.
     */
    priority?: number;

    /**
     * File's URL.
     */
    url?: string;

    /**
     * File's revision.
     */
    revision?: number;

    /**
     * File's timemodified.
     */
    timemodified?: number;

    /**
     * 1 if it's a external file (from an external repository), 0 otherwise.
     */
    isexternalfile?: number;

    /**
     * Type of the repository this file belongs to.
     */
    repositorytype?: string;

    /**
     * File's path.
     */
    path?: string;

    /**
     * File links (to link the file to components and componentIds).
     */
    links?: CoreFilepoolComponentLink[];
}

/**
 * Entry from packages table.
 */
export interface CoreFilepoolPackageEntry {
    /**
     * Package id.
     */
    id?: string;

    /**
     * The component to link the files to.
     */
    component?: string;

    /**
     * An ID to use in conjunction with the component.
     */
    componentId?: string | number;

    /**
     * Package status.
     */
    status?: string;

    /**
     * Package previous status.
     */
    previous?: string;

    /**
     * Timestamp when this package was updated.
     */
    updated?: number;

    /**
     * Timestamp when this package was downloaded.
     */
    downloadTime?: number;

    /**
     * Previous download time.
     */
    previousDownloadTime?: number;

    /**
     * Extra data stored by the package.
     */
    extra?: string;
}

/**
 * A component link.
 */
export interface CoreFilepoolComponentLink {
    /**
     * Link's component.
     */
    component: string;

    /**
     * Link's componentId.
     */
    componentId?: string | number;
}

/**
 * File actions.
 */
export const enum CoreFilepoolFileActions {
    DOWNLOAD = 'download',
    DOWNLOADING = 'downloading',
    DELETED = 'deleted',
    OUTDATED = 'outdated',
}

/**
 * Data sent to file events.
 */
export interface CoreFilepoolFileEventData {
    /**
     * The file ID.
     */
    fileId: string;

    /**
     * The file ID.
     */
    action: CoreFilepoolFileActions;

    /**
     * Whether the action was a success. Only for DOWNLOAD action.
     */
    success?: boolean;
}

/**
 * Data sent to component file events.
 */
export interface CoreFilepoolComponentFileEventData extends CoreFilepoolFileEventData {
    /**
     * The component.
     */
    component: string;

    /**
     * The component ID.
     */
    componentId: string | number;
}

/*
 * Factory for handling downloading files and retrieve downloaded files.
 *
 * @description
 * This factory is responsible for handling downloading files.
 *
 * The two main goals of this is to keep the content available offline, and improve the user experience by caching
 * the content locally.
 */
@Injectable()
export class CoreFilepoolProvider {
    // Constants.
    protected QUEUE_PROCESS_INTERVAL = 0;
    protected FOLDER = 'filepool';
    protected WIFI_DOWNLOAD_THRESHOLD = 20971520; // 20MB.
    protected DOWNLOAD_THRESHOLD = 2097152; // 2MB.
    protected QUEUE_RUNNING = 'CoreFilepool:QUEUE_RUNNING';
    protected QUEUE_PAUSED = 'CoreFilepool:QUEUE_PAUSED';
    protected ERR_QUEUE_IS_EMPTY = 'CoreFilepoolError:ERR_QUEUE_IS_EMPTY';
    protected ERR_FS_OR_NETWORK_UNAVAILABLE = 'CoreFilepoolError:ERR_FS_OR_NETWORK_UNAVAILABLE';
    protected ERR_QUEUE_ON_PAUSE = 'CoreFilepoolError:ERR_QUEUE_ON_PAUSE';

    // Variables for database.
    protected QUEUE_TABLE = 'filepool_files_queue'; // Queue of files to download.
    protected FILES_TABLE = 'filepool_files'; // Downloaded files.
    protected LINKS_TABLE = 'filepool_files_links'; // Links between downloaded files and components.
    protected PACKAGES_TABLE = 'filepool_packages'; // Downloaded packages (sets of files).
    protected appTablesSchema: CoreAppSchema = {
        name: 'CoreFilepoolProvider',
        version: 1,
        tables: [
            {
                name: this.QUEUE_TABLE,
                columns: [
                    {
                        name: 'siteId',
                        type: 'TEXT'
                    },
                    {
                        name: 'fileId',
                        type: 'TEXT'
                    },
                    {
                        name: 'added',
                        type: 'INTEGER'
                    },
                    {
                        name: 'priority',
                        type: 'INTEGER'
                    },
                    {
                        name: 'url',
                        type: 'TEXT'
                    },
                    {
                        name: 'revision',
                        type: 'INTEGER'
                    },
                    {
                        name: 'timemodified',
                        type: 'INTEGER'
                    },
                    {
                        name: 'isexternalfile',
                        type: 'INTEGER'
                    },
                    {
                        name: 'repositorytype',
                        type: 'TEXT'
                    },
                    {
                        name: 'path',
                        type: 'TEXT'
                    },
                    {
                        name: 'links',
                        type: 'TEXT'
                    },
                ],
                primaryKeys: ['siteId', 'fileId'],
            },
        ],
    };
    protected siteSchema: CoreSiteSchema = {
        name: 'CoreFilepoolProvider',
        version: 1,
        tables: [
            {
                name: this.FILES_TABLE,
                columns: [
                    {
                        name: 'fileId',
                        type: 'TEXT',
                        primaryKey: true
                    },
                    {
                        name: 'url',
                        type: 'TEXT',
                        notNull: true
                    },
                    {
                        name: 'revision',
                        type: 'INTEGER'
                    },
                    {
                        name: 'timemodified',
                        type: 'INTEGER'
                    },
                    {
                        name: 'stale',
                        type: 'INTEGER'
                    },
                    {
                        name: 'downloadTime',
                        type: 'INTEGER'
                    },
                    {
                        name: 'isexternalfile',
                        type: 'INTEGER'
                    },
                    {
                        name: 'repositorytype',
                        type: 'TEXT'
                    },
                    {
                        name: 'path',
                        type: 'TEXT'
                    },
                    {
                        name: 'extension',
                        type: 'TEXT'
                    }
                ]
            },
            {
                name: this.LINKS_TABLE,
                columns: [
                    {
                        name: 'fileId',
                        type: 'TEXT'
                    },
                    {
                        name: 'component',
                        type: 'TEXT'
                    },
                    {
                        name: 'componentId',
                        type: 'TEXT'
                    }
                ],
                primaryKeys: ['fileId', 'component', 'componentId']
            },
            {
                name: this.PACKAGES_TABLE,
                columns: [
                    {
                        name: 'id',
                        type: 'TEXT',
                        primaryKey: true
                    },
                    {
                        name: 'component',
                        type: 'TEXT'
                    },
                    {
                        name: 'componentId',
                        type: 'TEXT'
                    },
                    {
                        name: 'status',
                        type: 'TEXT'
                    },
                    {
                        name: 'previous',
                        type: 'TEXT'
                    },
                    {
                        name: 'updated',
                        type: 'INTEGER'
                    },
                    {
                        name: 'downloadTime',
                        type: 'INTEGER'
                    },
                    {
                        name: 'previousDownloadTime',
                        type: 'INTEGER'
                    },
                    {
                        name: 'extra',
                        type: 'TEXT'
                    }
                ]
            }
        ]
    };

    protected logger;
    protected appDB: SQLiteDB;
    protected dbReady: Promise<any>; // Promise resolved when the app DB is initialized.
    protected tokenRegex = new RegExp('(\\?|&)token=([A-Za-z0-9]*)');
    protected queueState: string;
    protected urlAttributes = [
        this.tokenRegex,
        new RegExp('(\\?|&)forcedownload=[0-1]'),
        new RegExp('(\\?|&)preview=[A-Za-z0-9]+'),
        new RegExp('(\\?|&)offline=[0-1]', 'g')
    ];
    protected queueDeferreds = {}; // To handle file downloads using the queue.
    protected sizeCache = {}; // A "cache" to store file sizes to prevent performing too many HEAD requests.
    // Variables to prevent downloading packages/files twice at the same time.
    protected packagesPromises = {};
    protected filePromises: { [s: string]: { [s: string]: Promise<any> } } = {};

    constructor(logger: CoreLoggerProvider,
            protected appProvider: CoreAppProvider,
            protected fileProvider: CoreFileProvider,
            protected sitesProvider: CoreSitesProvider,
            protected wsProvider: CoreWSProvider,
            protected textUtils: CoreTextUtilsProvider,
            protected utils: CoreUtilsProvider,
            protected mimeUtils: CoreMimetypeUtilsProvider,
            protected urlUtils: CoreUrlUtilsProvider,
            protected timeUtils: CoreTimeUtilsProvider,
            protected eventsProvider: CoreEventsProvider,
            initDelegate: CoreInitDelegate,
            network: Network,
            protected pluginFileDelegate: CorePluginFileDelegate,
            protected domUtils: CoreDomUtilsProvider,
            zone: NgZone) {
        this.logger = logger.getInstance('CoreFilepoolProvider');

        this.appDB = this.appProvider.getDB();
        this.dbReady = appProvider.createTablesFromSchema(this.appTablesSchema).catch(() => {
            // Ignore errors.
        });

        this.sitesProvider.registerSiteSchema(this.siteSchema);

        initDelegate.ready().then(() => {
            // Waiting for the app to be ready to start processing the queue.
            this.checkQueueProcessing();

            // Start queue when device goes online.
            network.onConnect().subscribe(() => {
                // Execute the callback in the Angular zone, so change detection doesn't stop working.
                zone.run(() => {
                    this.checkQueueProcessing();
                });
            });
        });
    }

    /**
     * Link a file with a component.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved on success.
     */
    protected addFileLink(siteId: string, fileId: string, component: string, componentId?: string | number): Promise<any> {
        if (!component) {
            return Promise.reject(null);
        }

        componentId = this.fixComponentId(componentId);

        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            const newEntry = {
                fileId: fileId,
                component: component,
                componentId: componentId || ''
            };

            return db.insertRecord(this.LINKS_TABLE, newEntry);
        });
    }

    /**
     * Link a file with a component by URL.
     *
     * @param siteId The site ID.
     * @param fileUrl The file Url.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved on success.
     * @description
     * Use this method to create a link between a URL and a component. You usually do not need to call this manually since
     * downloading a file automatically does this. Note that this method does not check if the file exists in the pool.
     */
    addFileLinkByUrl(siteId: string, fileUrl: string, component: string, componentId?: string | number): Promise<any> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.addFileLink(siteId, fileId, component, componentId);
        });
    }

    /**
     * Link a file with several components.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links Array of objects containing the component and optionally componentId.
     * @return Promise resolved on success.
     */
    protected addFileLinks(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): Promise<any> {
        const promises = [];
        links.forEach((link) => {
            promises.push(this.addFileLink(siteId, fileId, link.component, link.componentId));
        });

        return Promise.all(promises);
    }

    /**
     * Add files to queue using a URL.
     *
     * @param siteId The site ID.
     * @param files Array of files to add.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component (optional).
     * @return Resolved on success.
     */
    addFilesToQueue(siteId: string, files: any[], component?: string, componentId?: string | number): Promise<any> {
        return this.downloadOrPrefetchFiles(siteId, files, true, false, component, componentId);
    }

    /**
     * Add a file to the pool.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param data Additional information to store about the file (timemodified, url, ...). See FILES_TABLE schema.
     * @return Promise resolved on success.
     */
    protected addFileToPool(siteId: string, fileId: string, data: any): Promise<any> {
        const values = Object.assign({}, data);
        values.fileId = fileId;

        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return db.insertRecord(this.FILES_TABLE, values);
        });
    }

    /**
     * Adds a hash to a filename if needed.
     *
     * @param url The URL of the file, already treated (decoded, without revision, etc.).
     * @param filename The filename.
     * @return The filename with the hash.
     */
    protected addHashToFilename(url: string, filename: string): string {
        // Check if the file already has a hash. If a file is downloaded and re-uploaded with the app it will have a hash already.
        const matches = filename.match(/_[a-f0-9]{32}/g);

        if (matches && matches.length) {
            // There is at least 1 match. Get the last one.
            const hash = matches[matches.length - 1],
                treatedUrl = url.replace(hash, ''); // Remove the hash from the URL.

            // Check that the hash is valid.
            if ('_' + Md5.hashAsciiStr('url:' + treatedUrl) == hash) {
                // The data found is a hash of the URL, don't need to add it again.
                return filename;
            }
        }

        return filename + '_' + Md5.hashAsciiStr('url:' + url);
    }

    /**
     * Add a file to the queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param url The absolute URL to the file.
     * @param priority The priority this file should get in the queue (range 0-999).
     * @param revision The revision of the file.
     * @param timemodified The time this file was modified. Can be used to check file state.
     * @param filePath Filepath to download the file to. If not defined, download to the filepool folder.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param link The link to add for the file.
     * @return Promise resolved when the file is downloaded.
     */
    protected async addToQueue(siteId: string, fileId: string, url: string, priority: number, revision: number,
            timemodified: number, filePath: string, onProgress?: (event: any) => any, options: any = {},
            link?: CoreFilepoolComponentLink): Promise<any> {

        await this.dbReady;

        this.logger.debug(`Adding ${fileId} to the queue`);

        await this.appDB.insertRecord(this.QUEUE_TABLE, {
            siteId: siteId,
            fileId: fileId,
            url: url,
            priority: priority,
            revision: revision,
            timemodified: timemodified,
            path: filePath,
            isexternalfile: options.isexternalfile ? 1 : 0,
            repositorytype: options.repositorytype,
            links: JSON.stringify(link ? [link] : []),
            added: Date.now()
        });

        // Check if the queue is running.
        this.checkQueueProcessing();
        this.notifyFileDownloading(siteId, fileId, link ? [link] : []);

        return this.getQueuePromise(siteId, fileId, true, onProgress);
    }

    /**
     * Add an entry to queue using a URL.
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component (optional).
     * @param timemodified The time this file was modified. Can be used to check file state.
     * @param filePath Filepath to download the file to. If not defined, download to the filepool folder.
     * @param onProgress Function to call on progress.
     * @param priority The priority this file should get in the queue (range 0-999).
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @param alreadyFixed Whether the URL has already been fixed.
     * @return Resolved on success.
     */
    async addToQueueByUrl(siteId: string, fileUrl: string, component?: string, componentId?: string | number,
            timemodified: number = 0, filePath?: string, onProgress?: (event: any) => any, priority: number = 0, options: any = {},
            revision?: number, alreadyFixed?: boolean): Promise<any> {
        await this.dbReady;

        let fileId,
            queueDeferred;

        if (!this.fileProvider.isAvailable()) {
            return Promise.reject(null);
        }

        return this.sitesProvider.getSite(siteId).then((site) => {
            if (!site.canDownloadFiles()) {
                return Promise.reject(null);
            }

            if (alreadyFixed) {
                // Already fixed, if we reached here it means it can be downloaded.
                return <CoreWSExternalFile> {fileurl: fileUrl};
            } else {
                return this.fixPluginfileURL(siteId, fileUrl);
            }
        }).then((file) => {

            fileUrl = file.fileurl;
            timemodified = file.timemodified || timemodified;
            revision = revision || this.getRevisionFromUrl(fileUrl);
            fileId = this.getFileIdByUrl(fileUrl);

            const primaryKey = { siteId: siteId, fileId: fileId };

            // Set up the component.
            const link = this.createComponentLink(component, componentId);

            // Retrieve the queue deferred now if it exists.
            // This is to prevent errors if file is removed from queue while we're checking if the file is in queue.
            queueDeferred = this.getQueueDeferred(siteId, fileId, false, onProgress);

            return this.hasFileInQueue(siteId, fileId).then((entry: CoreFilepoolQueueEntry) => {
                const newData: any = {};
                let foundLink = false;

                if (entry) {
                    // We already have the file in queue, we update the priority and links.
                    if (entry.priority < priority) {
                        newData.priority = priority;
                    }
                    if (revision && entry.revision !== revision) {
                        newData.revision = revision;
                    }
                    if (timemodified && entry.timemodified !== timemodified) {
                        newData.timemodified = timemodified;
                    }
                    if (filePath && entry.path !== filePath) {
                        newData.path = filePath;
                    }
                    if (entry.isexternalfile !== options.isexternalfile && (entry.isexternalfile || options.isexternalfile)) {
                        newData.isexternalfile = options.isexternalfile;
                    }
                    if (entry.repositorytype !== options.repositorytype && (entry.repositorytype || options.repositorytype)) {
                        newData.repositorytype = options.repositorytype;
                    }

                    if (link) {
                        // We need to add the new link if it does not exist yet.
                        if (entry.links && entry.links.length) {
                            for (const i in entry.links) {
                                const fileLink = entry.links[i];
                                if (fileLink.component == link.component && fileLink.componentId == link.componentId) {
                                    foundLink = true;
                                    break;
                                }
                            }
                        }

                        if (!foundLink) {
                            newData.links = entry.links || [];
                            newData.links.push(link);
                            newData.links = JSON.stringify(entry.links);
                        }
                    }

                    if (Object.keys(newData).length) {
                        // Update only when required.
                        this.logger.debug(`Updating file ${fileId} which is already in queue`);

                        return this.appDB.updateRecords(this.QUEUE_TABLE, newData, primaryKey).then(() => {
                            return this.getQueuePromise(siteId, fileId, true, onProgress);
                        });
                    }

                    this.logger.debug(`File ${fileId} already in queue and does not require update`);
                    if (queueDeferred) {
                        // If we were able to retrieve the queue deferred before, we use that one.
                        return queueDeferred.promise;
                    } else {
                        // Create a new deferred and return its promise.
                        return this.getQueuePromise(siteId, fileId, true, onProgress);
                    }
                } else {
                    return this.addToQueue(
                        siteId, fileId, fileUrl, priority, revision, timemodified, filePath, onProgress, options, link);
                }
            }, () => {
                // Unsure why we could not get the record, let's add to the queue anyway.
                return this.addToQueue(
                    siteId, fileId, fileUrl, priority, revision, timemodified, filePath, onProgress, options, link);
            });
        });
    }

    /**
     * Adds a file to the queue if the size is allowed to be downloaded.
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file, already fixed.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param timemodified The time this file was modified.
     * @param checkSize True if we shouldn't download files if their size is big, false otherwise.
     * @param downloadUnknown True to download file in WiFi if their size is unknown, false otherwise.
     *                        Ignored if checkSize=false.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Promise resolved when the file is downloaded.
     */
    protected addToQueueIfNeeded(siteId: string, fileUrl: string, component: string, componentId?: string | number,
            timemodified: number = 0, checkSize: boolean = true, downloadUnknown?: boolean, options: any = {}, revision?: number)
            : Promise<any> {
        let promise;

        if (checkSize) {
            if (typeof this.sizeCache[fileUrl] != 'undefined') {
                promise = Promise.resolve(this.sizeCache[fileUrl]);
            } else {
                if (!this.appProvider.isOnline()) {
                    // Cannot check size in offline, stop.
                    return Promise.reject(null);
                }

                promise = this.wsProvider.getRemoteFileSize(fileUrl);
            }

            // Calculate the size of the file.
            return promise.then((size) => {
                const isWifi = this.appProvider.isWifi(),
                    sizeUnknown = size <= 0;

                if (!sizeUnknown) {
                    // Store the size in the cache.
                    this.sizeCache[fileUrl] = size;
                }

                // Check if the file should be downloaded.
                if (sizeUnknown) {
                    if (downloadUnknown && isWifi) {
                        return this.addToQueueByUrl(siteId, fileUrl, component, componentId, timemodified, undefined, undefined,
                                0, options, revision, true);
                    }
                } else if (this.shouldDownload(size)) {
                    return this.addToQueueByUrl(siteId, fileUrl, component, componentId, timemodified, undefined, undefined, 0,
                            options, revision, true);
                }
            });
        } else {
            // No need to check size, just add it to the queue.
            return this.addToQueueByUrl(siteId, fileUrl, component, componentId, timemodified, undefined, undefined, 0, options,
                    revision, true);
        }
    }

    /**
     * Check the queue processing.
     *
     * @description
     * In mose cases, this will enable the queue processing if it was paused.
     * Though, this will disable the queue if we are missing network or if the file system
     * is not accessible. Also, this will have no effect if the queue is already running.
     */
    protected checkQueueProcessing(): void {
        if (!this.fileProvider.isAvailable() || !this.appProvider.isOnline()) {
            this.queueState = this.QUEUE_PAUSED;

            return;
        } else if (this.queueState === this.QUEUE_RUNNING) {
            return;
        }

        this.queueState = this.QUEUE_RUNNING;
        this.processQueue();
    }

    /**
     * Clear all packages status in a site.
     *
     * @param siteId Site ID.
     * @return Promise resolved when all status are cleared.
     */
    clearAllPackagesStatus(siteId: string): Promise<any> {
        this.logger.debug('Clear all packages status for site ' + siteId);

        return this.sitesProvider.getSite(siteId).then((site) => {
            // Get all the packages to be able to "notify" the change in the status.
            return site.getDb().getAllRecords(this.PACKAGES_TABLE).then((entries) => {
                // Delete all the entries.
                return site.getDb().deleteRecords(this.PACKAGES_TABLE).then(() => {
                    entries.forEach((entry) => {
                        // Trigger module status changed, setting it as not downloaded.
                        this.triggerPackageStatusChanged(siteId, CoreConstants.NOT_DOWNLOADED, entry.component, entry.componentId);
                    });
                });
            });
        });
    }

    /**
     * Clears the filepool. Use it only when all the files from a site are deleted.
     *
     * @param siteId ID of the site to clear.
     * @return Promise resolved when the filepool is cleared.
     */
    clearFilepool(siteId: string): Promise<any> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return Promise.all([
                db.deleteRecords(this.FILES_TABLE),
                db.deleteRecords(this.LINKS_TABLE)
            ]);
        });
    }

    /**
     * Returns whether a component has files in the pool.
     *
     * @param siteId The site ID.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Resolved means yes, rejected means no.
     */
    componentHasFiles(siteId: string, component: string, componentId?: string | number): Promise<void> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            const conditions = {
                component: component,
                componentId: this.fixComponentId(componentId)
            };

            return db.countRecords(this.LINKS_TABLE, conditions).then((count) => {
                if (count <= 0) {
                    return Promise.reject(null);
                }
            });
        });
    }

    /**
     * Prepare a component link.
     *
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Link, null if nothing to link.
     */
    protected createComponentLink(component: string, componentId?: string | number): CoreFilepoolComponentLink {
        if (typeof component != 'undefined' && component != null)  {
            return { component: component, componentId: this.fixComponentId(componentId) };
        }

        return null;
    }

    /**
     * Prepare list of links from component and componentId.
     *
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Links.
     */
    protected createComponentLinks(component: string, componentId?: string | number): CoreFilepoolComponentLink[] {
        const link = this.createComponentLink(component, componentId);

        return link ? [link] : [];
    }

    /**
     * Given the current status of a list of packages and the status of one of the packages,
     * determine the new status for the list of packages. The status of a list of packages is:
     *     - CoreConstants.NOT_DOWNLOADABLE if there are no downloadable packages.
     *     - CoreConstants.NOT_DOWNLOADED if at least 1 package has status CoreConstants.NOT_DOWNLOADED.
     *     - CoreConstants.DOWNLOADED if ALL the downloadable packages have status CoreConstants.DOWNLOADED.
     *     - CoreConstants.DOWNLOADING if ALL the downloadable packages have status CoreConstants.DOWNLOADING or
     *                                     CoreConstants.DOWNLOADED, with at least 1 package with CoreConstants.DOWNLOADING.
     *     - CoreConstants.OUTDATED if ALL the downloadable packages have status CoreConstants.OUTDATED or CoreConstants.DOWNLOADED
     *                                     or CoreConstants.DOWNLOADING, with at least 1 package with CoreConstants.OUTDATED.
     *
     * @param current Current status of the list of packages.
     * @param packagestatus Status of one of the packages.
     * @return New status for the list of packages;
     */
    determinePackagesStatus(current: string, packageStatus: string): string {
        if (!current) {
            current = CoreConstants.NOT_DOWNLOADABLE;
        }

        if (packageStatus === CoreConstants.NOT_DOWNLOADED) {
            // If 1 package is not downloaded the status of the whole list will always be not downloaded.
            return CoreConstants.NOT_DOWNLOADED;
        } else if (packageStatus === CoreConstants.DOWNLOADED && current === CoreConstants.NOT_DOWNLOADABLE) {
            // If all packages are downloaded or not downloadable with at least 1 downloaded, status will be downloaded.
            return CoreConstants.DOWNLOADED;
        } else if (packageStatus === CoreConstants.DOWNLOADING &&
            (current === CoreConstants.NOT_DOWNLOADABLE || current === CoreConstants.DOWNLOADED)) {
            // If all packages are downloading/downloaded/notdownloadable with at least 1 downloading, status will be downloading.
            return CoreConstants.DOWNLOADING;
        } else if (packageStatus === CoreConstants.OUTDATED && current !== CoreConstants.NOT_DOWNLOADED) {
            // If there are no packages notdownloaded and there is at least 1 outdated, status will be outdated.
            return CoreConstants.OUTDATED;
        }

        // Status remains the same.
        return current;
    }

    /**
     * Downloads a URL and update or add it to the pool.
     *
     * This uses the file system, you should always make sure that it is accessible before calling this method.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @param options Extra options (revision, timemodified, isexternalfile, repositorytype).
     * @param filePath Filepath to download the file to. If defined, no extension will be added.
     * @param onProgress Function to call on progress.
     * @param poolFileObject When set, the object will be updated, a new entry will not be created.
     * @return Resolved with internal URL on success, rejected otherwise.
     */
    protected downloadForPoolByUrl(siteId: string, fileUrl: string, options: any = {}, filePath?: string,
        onProgress?: (event: any) => any, poolFileObject?: CoreFilepoolFileEntry): Promise<any> {

        const fileId = this.getFileIdByUrl(fileUrl),
            extension = this.mimeUtils.guessExtensionFromUrl(fileUrl),
            addExtension = typeof filePath == 'undefined',
            pathPromise = filePath ? filePath : this.getFilePath(siteId, fileId, extension);

        return Promise.resolve(pathPromise).then((filePath) => {
            if (poolFileObject && poolFileObject.fileId !== fileId) {
                this.logger.error('Invalid object to update passed');

                return Promise.reject(null);
            }

            const downloadId = this.getFileDownloadId(fileUrl, filePath);

            if (this.filePromises[siteId] && this.filePromises[siteId][downloadId]) {
                // There's already a download ongoing for this file in this location, return the promise.
                return this.filePromises[siteId][downloadId];
            } else if (!this.filePromises[siteId]) {
                this.filePromises[siteId] = {};
            }

            this.filePromises[siteId][downloadId] = this.sitesProvider.getSite(siteId).then((site) => {
                if (!site.canDownloadFiles()) {
                    return Promise.reject(null);
                }

                let fileEntry;

                return this.wsProvider.downloadFile(fileUrl, filePath, addExtension, onProgress).then((entry) => {
                    fileEntry = entry;

                    return this.pluginFileDelegate.treatDownloadedFile(fileUrl, fileEntry, siteId, onProgress);
                }).then(() => {
                    const data: CoreFilepoolFileEntry = poolFileObject || {};

                    data.downloadTime = Date.now();
                    data.stale = 0;
                    data.url = fileUrl;
                    data.revision = options.revision;
                    data.timemodified = options.timemodified;
                    data.isexternalfile = options.isexternalfile ? 1 : 0;
                    data.repositorytype = options.repositorytype;
                    data.path = fileEntry.path;
                    data.extension = fileEntry.extension;

                    return this.addFileToPool(siteId, fileId, data).then(() => {
                        return fileEntry.toURL();
                    });
                });
            }).finally(() => {
                // Download finished, delete the promise.
                delete this.filePromises[siteId][downloadId];
            });

            return this.filePromises[siteId][downloadId];
        });
    }

    /**
     * Download or prefetch several files into the filepool folder.
     *
     * @param siteId The site ID.
     * @param files Array of files to download.
     * @param prefetch True if should prefetch the contents (queue), false if they should be downloaded right now.
     * @param ignoreStale True if 'stale' should be ignored. Only if prefetch=false.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param dirPath Name of the directory where to store the files (inside filepool dir). If not defined, store
     *                the files directly inside the filepool folder.
     * @return Resolved on success.
     */
    downloadOrPrefetchFiles(siteId: string, files: any[], prefetch: boolean, ignoreStale?: boolean, component?: string,
            componentId?: string | number, dirPath?: string): Promise<any> {
        const promises = [];

        // Download files.
        files.forEach((file) => {
            const url = file.url || file.fileurl,
                timemodified = file.timemodified,
                options = {
                    isexternalfile: file.isexternalfile,
                    repositorytype: file.repositorytype
                };
            let path;

            if (dirPath) {
                // Calculate the path to the file.
                path = file.filename;
                if (file.filepath !== '/') {
                    path = file.filepath.substr(1) + path;
                }
                path = this.textUtils.concatenatePaths(dirPath, path);
            }

            if (prefetch) {
                promises.push(this.addToQueueByUrl(
                    siteId, url, component, componentId, timemodified, path, undefined, 0, options));
            } else {
                promises.push(this.downloadUrl(
                    siteId, url, ignoreStale, component, componentId, timemodified, path, undefined, options));
            }
        });

        return this.utils.allPromises(promises);
    }

    /**
     * Downloads or prefetches a list of files as a "package".
     *
     * @param siteId The site ID.
     * @param fileList List of files to download.
     * @param prefetch True if should prefetch the contents (queue), false if they should be downloaded right now.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param extra Extra data to store for the package.
     * @param dirPath Name of the directory where to store the files (inside filepool dir). If not defined, store
     *                the files directly inside the filepool folder.
     * @param onProgress Function to call on progress.
     * @return Promise resolved when the package is downloaded.
     */
    protected downloadOrPrefetchPackage(siteId: string, fileList: any[], prefetch?: boolean, component?: string,
            componentId?: string | number, extra?: string, dirPath?: string, onProgress?: (event: any) => any): Promise<any> {

        const packageId = this.getPackageId(component, componentId);
        let promise;

        if (this.packagesPromises[siteId] && this.packagesPromises[siteId][packageId]) {
            // There's already a download ongoing for this package, return the promise.
            return this.packagesPromises[siteId][packageId];
        } else if (!this.packagesPromises[siteId]) {
            this.packagesPromises[siteId] = {};
        }

        // Set package as downloading.
        promise = this.storePackageStatus(siteId, CoreConstants.DOWNLOADING, component, componentId).then(() => {
            const promises = [];
            let packageLoaded = 0;

            fileList.forEach((file) => {
                const fileUrl = file.url || file.fileurl,
                    options = {
                        isexternalfile: file.isexternalfile,
                        repositorytype: file.repositorytype
                    };
                let path,
                    promise,
                    fileLoaded = 0,
                    onFileProgress;

                if (onProgress) {
                    // There's a onProgress event, create a function to receive file download progress events.
                    onFileProgress = (progress: any): void => {
                        if (progress && progress.loaded) {
                            // Add the new size loaded to the package loaded.
                            packageLoaded = packageLoaded + (progress.loaded - fileLoaded);
                            fileLoaded = progress.loaded;
                            onProgress({
                                packageDownload: true,
                                loaded: packageLoaded,
                                fileProgress: progress
                            });
                        }
                    };
                }

                if (dirPath) {
                    // Calculate the path to the file.
                    path = file.filename;
                    if (file.filepath !== '/') {
                        path = file.filepath.substr(1) + path;
                    }
                    path = this.textUtils.concatenatePaths(dirPath, path);
                }

                if (prefetch) {
                    promise = this.addToQueueByUrl(
                        siteId, fileUrl, component, componentId, file.timemodified, path, undefined, 0, options);
                } else {
                    promise = this.downloadUrl(
                        siteId, fileUrl, false, component, componentId, file.timemodified, onFileProgress, path, options);
                }

                // Using undefined for success & fail will pass the success/failure to the parent promise.
                promises.push(promise);
            });

            return Promise.all(promises).then(() => {
                // Success prefetching, store package as downloaded.
                return this.storePackageStatus(siteId, CoreConstants.DOWNLOADED, component, componentId, extra);
            }).catch((error) => {
                // Error downloading, go back to previous status and reject the promise.
                return this.setPackagePreviousStatus(siteId, component, componentId).then(() => {
                    return Promise.reject(error);
                });
            });

        }).finally(() => {
            // Download finished, delete the promise.
            delete this.packagesPromises[siteId][packageId];
        });

        this.packagesPromises[siteId][packageId] = promise;

        return promise;
    }

    /**
     * Downloads a list of files.
     *
     * @param siteId The site ID.
     * @param fileList List of files to download.
     * @param component The component to link the file to.
     * @param componentId An ID to identify the download.
     * @param extra Extra data to store for the package.
     * @param dirPath Name of the directory where to store the files (inside filepool dir). If not defined, store
     *                the files directly inside the filepool folder.
     * @param onProgress Function to call on progress.
     * @return Promise resolved when all files are downloaded.
     */
    downloadPackage(siteId: string, fileList: any[], component: string, componentId?: string | number, extra?: string,
            dirPath?: string, onProgress?: (event: any) => any): Promise<any> {
        return this.downloadOrPrefetchPackage(siteId, fileList, false, component, componentId, extra, dirPath, onProgress);
    }

    /**
     * Downloads a file on the spot.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @param ignoreStale Whether 'stale' should be ignored.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param timemodified The time this file was modified. Can be used to check file state.
     * @param filePath Filepath to download the file to. If not defined, download to the filepool folder.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Resolved with internal URL on success, rejected otherwise.
     * @description
     * Downloads a file on the spot.
     *
     * This will also take care of adding the file to the pool if it's missing. However, please note that this will
     * not force a file to be re-downloaded if it is already part of the pool. You should mark a file as stale using
     * invalidateFileByUrl to trigger a download.
     */
    downloadUrl(siteId: string, fileUrl: string, ignoreStale?: boolean, component?: string, componentId?: string | number,
            timemodified: number = 0, onProgress?: (event: any) => any, filePath?: string, options: any = {}, revision?: number)
            : Promise<any> {
        let fileId;
        let promise;
        let alreadyDownloaded = true;

        if (this.fileProvider.isAvailable()) {
            return this.fixPluginfileURL(siteId, fileUrl).then((file) => {

                fileUrl = file.fileurl;
                timemodified = file.timemodified || timemodified;

                options = Object.assign({}, options); // Create a copy to prevent modifying the original object.
                options.timemodified = timemodified || 0;
                options.revision = revision || this.getRevisionFromUrl(fileUrl);
                fileId = this.getFileIdByUrl(fileUrl);

                const links = this.createComponentLinks(component, componentId);

                return this.hasFileInPool(siteId, fileId).then((fileObject) => {

                    if (typeof fileObject === 'undefined') {
                        // We do not have the file, download and add to pool.
                        this.notifyFileDownloading(siteId, fileId, links);
                        alreadyDownloaded = false;

                        return this.downloadForPoolByUrl(siteId, fileUrl, options, filePath, onProgress);

                    } else if (this.isFileOutdated(fileObject, options.revision, options.timemodified) &&
                            this.appProvider.isOnline() && !ignoreStale) {
                        // The file is outdated, force the download and update it.
                        this.notifyFileDownloading(siteId, fileId, links);
                        alreadyDownloaded = false;

                        return this.downloadForPoolByUrl(siteId, fileUrl, options, filePath, onProgress, fileObject);
                    }

                    // Everything is fine, return the file on disk.
                    if (filePath) {
                        promise = this.getInternalUrlByPath(filePath);
                    } else {
                        promise = this.getInternalUrlById(siteId, fileId);
                    }

                    return promise.then((response) => {
                        return response;
                    }, () => {
                        // The file was not found in the pool, weird.
                        this.notifyFileDownloading(siteId, fileId, links);
                        alreadyDownloaded = false;

                        return this.downloadForPoolByUrl(siteId, fileUrl, options, filePath, onProgress, fileObject);
                    });

                }, () => {
                    // The file is not in the pool just yet.
                    this.notifyFileDownloading(siteId, fileId, links);
                    alreadyDownloaded = false;

                    return this.downloadForPoolByUrl(siteId, fileUrl, options, filePath, onProgress);
                }).then((response) => {
                    if (typeof component != 'undefined') {
                        this.addFileLink(siteId, fileId, component, componentId).catch(() => {
                            // Ignore errors.
                        });
                    }

                    if (!alreadyDownloaded) {
                        this.notifyFileDownloaded(siteId, fileId, links);
                    }

                    return response;
                }, (err) => {
                    this.notifyFileDownloadError(siteId, fileId, links);

                    return Promise.reject(err);
                });
            });
        } else {
            return Promise.reject(null);
        }
    }

    /**
     * Extract the downloadable URLs from an HTML code.
     *
     * @param html HTML code.
     * @return List of file urls.
     */
    extractDownloadableFilesFromHtml(html: string): string[] {
        let urls = [],
            elements;

        const element = this.domUtils.convertToElement(html);
        elements = element.querySelectorAll('a, img, audio, video, source, track');

        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            let url = element.tagName === 'A' ? element.href : element.src;

            if (url && this.urlUtils.isDownloadableUrl(url) && urls.indexOf(url) == -1) {
                urls.push(url);
            }

            // Treat video poster.
            if (element.tagName == 'VIDEO' && element.getAttribute('poster')) {
                url = element.getAttribute('poster');
                if (url && this.urlUtils.isDownloadableUrl(url) && urls.indexOf(url) == -1) {
                    urls.push(url);
                }
            }
        }

        // Now get other files from plugin file handlers.
        urls = urls.concat(this.pluginFileDelegate.getDownloadableFilesFromHTML(element));

        return urls;
    }

    /**
     * Extract the downloadable URLs from an HTML code and returns them in fake file objects.
     *
     * @param html HTML code.
     * @return List of fake file objects with file URLs.
     */
    extractDownloadableFilesFromHtmlAsFakeFileObjects(html: string): CoreWSExternalFile[] {
        const urls = this.extractDownloadableFilesFromHtml(html);

        // Convert them to fake file objects.
        return urls.map((url) => {
            return {
                fileurl: url
            };
        });
    }

    /**
     * Fill Missing Extension In the File Object if needed.
     * This is to migrate from old versions.
     *
     * @param fileObject File object to be migrated.
     * @param siteId SiteID to get migrated.
     * @return Promise resolved when done.
     */
    protected fillExtensionInFile(entry: CoreFilepoolFileEntry, siteId: string): Promise<any> {
        if (typeof entry.extension != 'undefined') {
            // Already filled.
            return Promise.resolve();
        }

        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            const extension = this.mimeUtils.getFileExtension(entry.path);
            if (!extension) {
                // Files does not have extension. Invalidate file (stale = true).
                // Minor problem: file will remain in the filesystem once downloaded again.
                this.logger.debug('Staled file with no extension ' + entry.fileId);

                return db.updateRecords(this.FILES_TABLE, { stale: 1 }, { fileId: entry.fileId });
            }

            // File has extension. Save extension, and add extension to path.
            const fileId = entry.fileId;
            entry.fileId = this.mimeUtils.removeExtension(fileId);
            entry.extension = extension;

            return db.updateRecords(this.FILES_TABLE, entry, { fileId: fileId }).then(() => {
                if (entry.fileId == fileId) {
                    // File ID hasn't changed, we're done.
                    this.logger.debug('Removed extesion ' + extension + ' from file ' + entry.fileId);

                    return;
                }

                // Now update the links.
                return db.updateRecords(this.LINKS_TABLE, { fileId: entry.fileId }, { fileId: fileId });
            });
        });
    }

    /**
     * Fix a component ID to always be a Number if possible.
     *
     * @param componentId The component ID.
     * @return The normalised component ID. -1 when undefined was passed.
     */
    protected fixComponentId(componentId: string | number): string | number {
        if (typeof componentId == 'number') {
            return componentId;
        }

        // Try to convert it to a number.
        const id = parseInt(componentId, 10);
        if (isNaN(id)) {
            // Not a number.
            if (typeof componentId == 'undefined' || componentId === null) {
                return -1;
            } else {
                return componentId;
            }
        }

        return id;
    }

    /**
     * Check whether the file can be downloaded, add the wstoken url and points to the correct script.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @param timemodified The timemodified of the file.
     * @return Promise resolved with the file data to use.
     */
    protected fixPluginfileURL(siteId: string, fileUrl: string, timemodified: number = 0): Promise<CoreWSExternalFile> {

        return this.pluginFileDelegate.getDownloadableFile({fileurl: fileUrl, timemodified: timemodified}).then((file) => {

            return this.sitesProvider.getSite(siteId).then((site) => {
                return site.checkAndFixPluginfileURL(file.fileurl);
            }).then((fixedUrl) => {
                file.fileurl = fixedUrl;

                return file;
            });
        });
    }

    /**
     * Convenience function to get component files.
     *
     * @param db Site's DB.
     * @param component The component to get.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the files.
     */
    protected getComponentFiles(db: SQLiteDB, component: string, componentId?: string | number): Promise<any[]> {
        const conditions = {
            component: component,
            componentId: this.fixComponentId(componentId)
        };

        return db.getRecords(this.LINKS_TABLE, conditions).then((items) => {
            items.forEach((item) => {
                item.componentId = this.fixComponentId(item.componentId);
            });

            return items;
        });
    }

    /**
     * Returns the local URL of a directory.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved with the URL. Rejected otherwise.
     */
    getDirectoryUrlByUrl(siteId: string, fileUrl: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
                const fileId = this.getFileIdByUrl(file.fileurl),
                    filePath = <string> this.getFilePath(siteId, fileId, ''); // No extension, the function will return a string.

                return this.fileProvider.getDir(filePath).then((dirEntry) => {
                    return dirEntry.toURL();
                });
            });
        }

        return Promise.reject(null);
    }

    /**
     * Get the ID of a file download. Used to keep track of filePromises.
     *
     * @param fileUrl The file URL.
     * @param filePath The file destination path.
     * @return File download ID.
     */
    protected getFileDownloadId(fileUrl: string, filePath: string): string {
        return <string> Md5.hashAsciiStr(fileUrl + '###' + filePath);
    }

    /**
     * Get the name of the event used to notify download events (CoreEventsProvider).
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Event name.
     */
    protected getFileEventName(siteId: string, fileId: string): string {
        return 'CoreFilepoolFile:' + siteId + ':' + fileId;
    }

    /**
     * Get the name of the event used to notify download events (CoreEventsProvider).
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file.
     * @return Promise resolved with event name.
     */
    getFileEventNameByUrl(siteId: string, fileUrl: string): Promise<string> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.getFileEventName(siteId, fileId);
        });
    }

    /**
     * Creates a unique ID based on a URL.
     *
     * This has a minimal handling of pluginfiles in order to generate a clean file ID which will not change if
     * pointing to the same pluginfile URL even if the token or extra attributes have changed.
     *
     * @param fileUrl The absolute URL to the file.
     * @return The file ID.
     */
    protected getFileIdByUrl(fileUrl: string): string {
        let url = fileUrl,
            filename;

        // If site supports it, since 3.8 we use tokenpluginfile instead of pluginfile.
        // For compatibility with files already downloaded, we need to use pluginfile to calculate the file ID.
        url = url.replace(/\/tokenpluginfile\.php\/[^\/]+\//, '/webservice/pluginfile.php/');

        // Remove the revision number from the URL so updates on the file aren't detected as a different file.
        url = this.removeRevisionFromUrl(url);

        // Decode URL.
        url = this.textUtils.decodeHTML(this.textUtils.decodeURIComponent(url));

        if (url.indexOf('/webservice/pluginfile') !== -1) {
            // Remove attributes that do not matter.
            this.urlAttributes.forEach((regex) => {
                url = url.replace(regex, '');
            });
        }

        // Try to guess the filename the target file should have.
        // We want to keep the original file name so people can easily identify the files after the download.
        filename = this.guessFilenameFromUrl(url);

        return this.addHashToFilename(url, filename);
    }

    /**
     * Get the links of a file.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Promise resolved with the links.
     */
    protected getFileLinks(siteId: string, fileId: string): Promise<any[]> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return db.getRecords(this.LINKS_TABLE, { fileId: fileId });
        }).then((items) => {
            items.forEach((item) => {
                item.componentId = this.fixComponentId(item.componentId);
            });

            return items;
        });
    }

    /**
     * Get the path to a file. This does not check if the file exists or not.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param extension Previously calculated extension. Empty to not add any. Undefined to calculate it.
     * @return The path to the file relative to storage root.
     */
    protected getFilePath(siteId: string, fileId: string, extension?: string): string | Promise<string> {
        let path = this.getFilepoolFolderPath(siteId) + '/' + fileId;
        if (typeof extension == 'undefined') {
            // We need the extension to be able to open files properly.
            return this.hasFileInPool(siteId, fileId).then((entry) => {
                if (entry.extension) {
                    path += '.' + entry.extension;
                }

                return path;
            }).catch(() => {
                // If file not found, use the path without extension.
                return path;
            });
        } else {
            if (extension) {
                path += '.' + extension;
            }

            return path;
        }
    }

    /**
     * Get the path to a file from its URL. This does not check if the file exists or not.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Promise resolved with the path to the file relative to storage root.
     */
    getFilePathByUrl(siteId: string, fileUrl: string): Promise<string> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.getFilePath(siteId, fileId);
        });
    }

    /**
     * Get site Filepool Folder Path
     *
     * @param siteId The site ID.
     * @return The root path to the filepool of the site.
     */
    getFilepoolFolderPath(siteId: string): string {
        return this.fileProvider.getSiteFolder(siteId) + '/' + this.FOLDER;
    }

    /**
     * Get all the matching files from a component. Returns objects containing properties like path, extension and url.
     *
     * @param siteId The site ID.
     * @param component The component to get.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the files on success.
     */
    getFilesByComponent(siteId: string, component: string, componentId?: string | number): Promise<any[]> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return this.getComponentFiles(db, component, componentId).then((items) => {
                const promises = [],
                    files = [];

                items.forEach((item) => {
                    promises.push(db.getRecord(this.FILES_TABLE, { fileId: item.fileId }).then((fileEntry) => {
                        if (!fileEntry) {
                            return;
                        }

                        files.push({
                            url: fileEntry.url,
                            path: fileEntry.path,
                            extension: fileEntry.extension,
                            revision: fileEntry.revision,
                            timemodified: fileEntry.timemodified
                        });
                    }).catch(() => {
                        // File not found, ignore error.
                    }));
                });

                return Promise.all(promises).then(() => {
                    return files;
                });
            });
        });
    }

    /**
     * Get the size of all the files from a component.
     *
     * @param siteId The site ID.
     * @param component The component to get.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the size on success.
     */
    getFilesSizeByComponent(siteId: string, component: string, componentId?: string | number): Promise<number> {
        return this.getFilesByComponent(siteId, component, componentId).then((files) => {
            const promises = [];
            let size = 0;

            files.forEach((file) => {
                promises.push(this.fileProvider.getFileSize(file.path).then((fs) => {
                    size += fs;
                }).catch(() => {
                    // Ignore failures, maybe some file was deleted.
                }));
            });

            return Promise.all(promises).then(() => {
                return size;
            });
        });
    }

    /**
     * Returns the file state: mmCoreDownloaded, mmCoreDownloading, mmCoreNotDownloaded or mmCoreOutdated.
     *
     * @param siteId The site ID.
     * @param fileUrl File URL.
     * @param timemodified The time this file was modified.
     * @param filePath Filepath to download the file to. If defined, no extension will be added.
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Promise resolved with the file state.
     */
    async getFileStateByUrl(siteId: string, fileUrl: string, timemodified: number = 0, filePath?: string, revision?: number)
            : Promise<string> {
        let file;

        try {
            file = await this.fixPluginfileURL(siteId, fileUrl, timemodified);
        } catch (e) {
            return CoreConstants.NOT_DOWNLOADABLE;
        }

        fileUrl = file.fileurl;
        timemodified = file.timemodified || timemodified;
        revision = revision || this.getRevisionFromUrl(fileUrl);
        const fileId = this.getFileIdByUrl(fileUrl);

        try {
            // Check if the file is in queue (waiting to be downloaded).
            await this.hasFileInQueue(siteId, fileId);

            return CoreConstants.DOWNLOADING;
        } catch (e) {
            // Check if the file is being downloaded right now.
            const extension = this.mimeUtils.guessExtensionFromUrl(fileUrl);
            filePath = filePath || (await this.getFilePath(siteId, fileId, extension));

            const downloadId = this.getFileDownloadId(fileUrl, filePath);

            if (this.filePromises[siteId] && this.filePromises[siteId][downloadId]) {
                return CoreConstants.DOWNLOADING;
            }

            try {
                // File is not being downloaded. Check if it's downloaded and if it's outdated.
                const entry = await this.hasFileInPool(siteId, fileId);

                if (this.isFileOutdated(entry, revision, timemodified)) {
                    return CoreConstants.OUTDATED;
                }

                return CoreConstants.DOWNLOADED;
            } catch (e) {
                return CoreConstants.NOT_DOWNLOADED;
            }
        }
    }

    /**
     * Returns an absolute URL to access the file URL.
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file.
     * @param mode The type of URL to return. Accepts 'url' or 'src'.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param timemodified The time this file was modified.
     * @param checkSize True if we shouldn't download files if their size is big, false otherwise.
     * @param downloadUnknown True to download file in WiFi if their size is unknown, false otherwise.
     *                        Ignored if checkSize=false.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Resolved with the URL to use.
     * @description
     * This will return a URL pointing to the content of the requested URL.
     *
     * This handles the queue and validity of the file. If there is a local file and it's valid, return the local URL.
     * If the file isn't downloaded or it's outdated, return the online URL and add it to the queue to be downloaded later.
     */
    protected getFileUrlByUrl(siteId: string, fileUrl: string, component: string, componentId?: string | number,
            mode: string = 'url', timemodified: number = 0, checkSize: boolean = true, downloadUnknown?: boolean,
            options: any = {}, revision?: number): Promise<string> {

        let fileId;
        const addToQueue = (fileUrl): void => {
                // Add the file to queue if needed and ignore errors.
                this.addToQueueIfNeeded(siteId, fileUrl, component, componentId, timemodified, checkSize,
                    downloadUnknown, options, revision).catch(() => {
                        // Ignore errors.
                    });
            };

        return this.fixPluginfileURL(siteId, fileUrl, timemodified).then((file) => {

            fileUrl = file.fileurl;
            timemodified = file.timemodified || timemodified;
            revision = revision || this.getRevisionFromUrl(fileUrl);
            fileId = this.getFileIdByUrl(fileUrl);

            return this.hasFileInPool(siteId, fileId).then((entry) => {
                let response;

                if (typeof entry === 'undefined') {
                    // We do not have the file, add it to the queue, and return real URL.
                    addToQueue(fileUrl);
                    response = fileUrl;

                } else if (this.isFileOutdated(entry, revision, timemodified) && this.appProvider.isOnline()) {
                    // The file is outdated, we add to the queue and return real URL.
                    addToQueue(fileUrl);
                    response = fileUrl;
                } else {
                    // We found the file entry, now look for the file on disk.
                    if (mode === 'src') {
                        response = this.getInternalSrcById(siteId, fileId);
                    } else {
                        response = this.getInternalUrlById(siteId, fileId);
                    }

                    response = response.then((internalUrl) => {
                        // The file is on disk.
                        return internalUrl;
                    }).catch(() => {
                        // We could not retrieve the file, delete the entries associated with that ID.
                        this.logger.debug('File ' + fileId + ' not found on disk');
                        this.removeFileById(siteId, fileId);
                        addToQueue(fileUrl);

                        if (this.appProvider.isOnline()) {
                            // We still have a chance to serve the right content.
                            return fileUrl;
                        }

                        return Promise.reject(null);
                    });
                }

                return response;
            }, () => {
                // We do not have the file in store yet. Add to queue and return the fixed URL.
                addToQueue(fileUrl);

                return fileUrl;
            });
        });
    }

    /**
     * Returns the internal SRC of a file.
     *
     * The returned URL from this method is typically used with IMG tags.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Resolved with the internal URL. Rejected otherwise.
     */
    protected getInternalSrcById(siteId: string, fileId: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return Promise.resolve(this.getFilePath(siteId, fileId)).then((path) => {
                return this.fileProvider.getFile(path).then((fileEntry) => {
                    return this.fileProvider.convertFileSrc(fileEntry.toURL());
                });
            });
        }

        return Promise.reject(null);
    }

    /**
     * Returns the local URL of a file.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Resolved with the URL. Rejected otherwise.
     */
    protected getInternalUrlById(siteId: string, fileId: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return Promise.resolve(this.getFilePath(siteId, fileId)).then((path) => {
                return this.fileProvider.getFile(path).then((fileEntry) => {
                    // This URL is usually used to launch files or put them in HTML. In desktop we need the internal URL.
                    if (this.appProvider.isDesktop()) {
                        return fileEntry.toInternalURL();
                    } else {
                        return fileEntry.toURL();
                    }
                });
            });
        }

        return Promise.reject(null);
    }

    /**
     * Returns the local URL of a file.
     *
     * @param filePath The file path.
     * @return Resolved with the URL.
     */
    protected getInternalUrlByPath(filePath: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return this.fileProvider.getFile(filePath).then((fileEntry) => {
                return fileEntry.toURL();
            });
        }

        return Promise.reject(null);
    }

    /**
     * Returns the local URL of a file.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved with the URL. Rejected otherwise.
     */
    getInternalUrlByUrl(siteId: string, fileUrl: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
                const fileId = this.getFileIdByUrl(file.fileurl);

                return this.getInternalUrlById(siteId, fileId);
            });
        }

        return Promise.reject(null);
    }

    /**
     * Get the data stored for a package.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the data.
     */
    getPackageData(siteId: string, component: string, componentId?: string | number): Promise<CoreFilepoolPackageEntry> {
        componentId = this.fixComponentId(componentId);

        return this.sitesProvider.getSite(siteId).then((site) => {
            const packageId = this.getPackageId(component, componentId);

            return site.getDb().getRecord(this.PACKAGES_TABLE, { id: packageId });
        });
    }

    /**
     * Creates the name for a package directory (hash).
     *
     * @param url An URL to identify the package.
     * @return The directory name.
     */
    protected getPackageDirNameByUrl(url: string): string {
        let candidate,
            extension = '';

        url = this.removeRevisionFromUrl(url);

        if (url.indexOf('/webservice/pluginfile') !== -1) {
            // Remove attributes that do not matter.
            this.urlAttributes.forEach((regex) => {
                url = url.replace(regex, '');
            });

            // Guess the extension of the URL. This is for backwards compatibility.
            candidate = this.mimeUtils.guessExtensionFromUrl(url);
            if (candidate && candidate !== 'php') {
                extension = '.' + candidate;
            }
        }

        return Md5.hashAsciiStr('url:' + url) + extension;
    }

    /**
     * Get the path to a directory to store a package files. This does not check if the file exists or not.
     *
     * @param siteId The site ID.
     * @param url An URL to identify the package.
     * @return Promise resolved with the path of the package.
     */
    getPackageDirPathByUrl(siteId: string, url: string): Promise<string> {
        return this.fixPluginfileURL(siteId, url).then((file) => {
            const dirName = this.getPackageDirNameByUrl(file.fileurl);

            return this.getFilePath(siteId, dirName, '');
        });
    }

    /**
     * Returns the local URL of a package directory.
     *
     * @param siteId The site ID.
     * @param url An URL to identify the package.
     * @return Resolved with the URL.
     */
    getPackageDirUrlByUrl(siteId: string, url: string): Promise<string> {
        if (this.fileProvider.isAvailable()) {
            return this.fixPluginfileURL(siteId, url).then((file) => {
                const dirName = this.getPackageDirNameByUrl(file.fileurl),
                    dirPath = <string> this.getFilePath(siteId, dirName, ''); // No extension, the function will return a string.

                return this.fileProvider.getDir(dirPath).then((dirEntry) => {
                    return dirEntry.toURL();
                });
            });
        }

        return Promise.reject(null);
    }

    /**
     * Get a download promise. If the promise is not set, return undefined.
     *
     * @param siteId Site ID.
     * @param component The component of the package.
     * @param componentId An ID to use in conjunction with the component.
     * @return Download promise or undefined.
     */
    getPackageDownloadPromise(siteId: string, component: string, componentId?: string | number): Promise<any> {
        const packageId = this.getPackageId(component, componentId);
        if (this.packagesPromises[siteId] && this.packagesPromises[siteId][packageId]) {
            return this.packagesPromises[siteId][packageId];
        }
    }
    /**
     * Get a package extra data.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the extra data.
     */
    getPackageExtra(siteId: string, component: string, componentId?: string | number): Promise<string> {
        return this.getPackageData(siteId, component, componentId).then((entry) => {
            return entry.extra;
        });
    }

    /**
     * Get the ID of a package.
     *
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Package ID.
     */
    getPackageId(component: string, componentId?: string | number): string {
        return <string> Md5.hashAsciiStr(component + '#' + this.fixComponentId(componentId));
    }

    /**
     * Get a package previous status.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the status.
     */
    getPackagePreviousStatus(siteId: string, component: string, componentId?: string | number): Promise<string> {
        return this.getPackageData(siteId, component, componentId).then((entry) => {
            return entry.previous || CoreConstants.NOT_DOWNLOADED;
        }).catch(() => {
            return CoreConstants.NOT_DOWNLOADED;
        });
    }

    /**
     * Get a package status.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved with the status.
     */
    getPackageStatus(siteId: string, component: string, componentId?: string | number): Promise<string> {
        return this.getPackageData(siteId, component, componentId).then((entry) => {
            return entry.status || CoreConstants.NOT_DOWNLOADED;
        }).catch(() => {
            return CoreConstants.NOT_DOWNLOADED;
        });
    }

    /**
     * Return the array of arguments of the pluginfile url.
     *
     * @param url URL to get the args.
     * @return The args found, undefined if not a pluginfile.
     */
    protected getPluginFileArgs(url: string): string[] {
        if (!this.urlUtils.isPluginFileUrl(url)) {
            // Not pluginfile, return.
            return;
        }

        const relativePath = url.substr(url.indexOf('/pluginfile.php') + 16),
            args = relativePath.split('/');

        if (args.length < 3) {
            // To be a plugin file it should have at least contextId, Component and Filearea.
            return;
        }

        return args;
    }

    /**
     * Get the deferred object for a file in the queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param create True if it should create a new deferred if it doesn't exist.
     * @param onProgress Function to call on progress.
     * @return Deferred.
     */
    protected getQueueDeferred(siteId: string, fileId: string, create: boolean = true, onProgress?: (event: any) => any): any {
        if (!this.queueDeferreds[siteId]) {
            if (!create) {
                return;
            }
            this.queueDeferreds[siteId] = {};
        }
        if (!this.queueDeferreds[siteId][fileId]) {
            if (!create) {
                return;
            }
            this.queueDeferreds[siteId][fileId] = this.utils.promiseDefer();
        }

        if (onProgress) {
            this.queueDeferreds[siteId][fileId].onProgress = onProgress;
        }

        return this.queueDeferreds[siteId][fileId];
    }

    /**
     * Get the on progress for a file in the queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return On progress function, undefined if not found.
     */
    protected getQueueOnProgress(siteId: string, fileId: string): (event: any) => any {
        const deferred = this.getQueueDeferred(siteId, fileId, false);
        if (deferred) {
            return deferred.onProgress;
        }
    }

    /**
     * Get the promise for a file in the queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param create True if it should create a new promise if it doesn't exist.
     * @param onProgress Function to call on progress.
     * @return Promise.
     */
    protected getQueuePromise(siteId: string, fileId: string, create: boolean = true, onProgress?: (event: any) => any)
            : Promise<any> {
        return this.getQueueDeferred(siteId, fileId, create, onProgress).promise;
    }

    /**
     * Get a revision number from a list of files (highest revision).
     *
     * @param files Package files.
     * @return Highest revision.
     */
    getRevisionFromFileList(files: any[]): number {
        let revision = 0;

        files.forEach((file) => {
            if (file.url || file.fileurl) {
                const r = this.getRevisionFromUrl(file.url || file.fileurl);
                if (r > revision) {
                    revision = r;
                }
            }
        });

        return revision;
    }

    /**
     * Get the revision number from a file URL.
     *
     * @param url URL to get the revision number.
     * @return Revision number.
     */
    protected getRevisionFromUrl(url: string): number {
        const args = this.getPluginFileArgs(url);
        if (!args) {
            // Not a pluginfile, no revision will be found.
            return 0;
        }

        const revisionRegex = this.pluginFileDelegate.getComponentRevisionRegExp(args);
        if (!revisionRegex) {
            return 0;
        }

        const matches = url.match(revisionRegex);
        if (matches && typeof matches[1] != 'undefined') {
            return parseInt(matches[1], 10);
        }

        return 0;
    }

    /**
     * Returns an absolute URL to use in IMG tags.
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file.
     * @param mode The type of URL to return. Accepts 'url' or 'src'.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param timemodified The time this file was modified.
     * @param checkSize True if we shouldn't download files if their size is big, false otherwise.
     * @param downloadUnknown True to download file in WiFi if their size is unknown, false otherwise.
     *                        Ignored if checkSize=false.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Resolved with the URL to use.
     * @description
     * This will return a URL pointing to the content of the requested URL.
     * The URL returned is compatible to use with IMG tags.
     */
    getSrcByUrl(siteId: string, fileUrl: string, component: string, componentId?: string | number, timemodified: number = 0,
            checkSize: boolean = true, downloadUnknown?: boolean, options: any = {}, revision?: number): Promise<string> {
        return this.getFileUrlByUrl(siteId, fileUrl, component, componentId, 'src',
            timemodified, checkSize, downloadUnknown, options, revision);
    }

    /**
     * Get time modified from a list of files.
     *
     * @param files List of files.
     * @return Time modified.
     */
    getTimemodifiedFromFileList(files: any[]): number {
        let timemodified = 0;

        files.forEach((file) => {
            if (file.timemodified > timemodified) {
                timemodified = file.timemodified;
            }
        });

        return timemodified;
    }

    /**
     * Returns an absolute URL to access the file.
     *
     * @param siteId The site ID.
     * @param fileUrl The absolute URL to the file.
     * @param mode The type of URL to return. Accepts 'url' or 'src'.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param timemodified The time this file was modified.
     * @param checkSize True if we shouldn't download files if their size is big, false otherwise.
     * @param downloadUnknown True to download file in WiFi if their size is unknown, false otherwise.
     *                        Ignored if checkSize=false.
     * @param options Extra options (isexternalfile, repositorytype).
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Resolved with the URL to use.
     * @description
     * This will return a URL pointing to the content of the requested URL.
     * The URL returned is compatible to use with a local browser.
     */
    getUrlByUrl(siteId: string, fileUrl: string, component: string, componentId?: string | number, timemodified: number = 0,
            checkSize: boolean = true, downloadUnknown?: boolean, options: any = {}, revision?: number): Promise<string> {
        return this.getFileUrlByUrl(siteId, fileUrl, component, componentId, 'url',
            timemodified, checkSize, downloadUnknown, options, revision);
    }

    /**
     * Guess the filename of a file from its URL. This is very weak and unreliable.
     *
     * @param fileUrl The file URL.
     * @return The filename treated so it doesn't have any special character.
     */
    protected guessFilenameFromUrl(fileUrl: string): string {
        let filename = '';

        if (fileUrl.indexOf('/webservice/pluginfile') !== -1) {
            // It's a pluginfile URL. Search for the 'file' param to extract the name.
            const params = this.urlUtils.extractUrlParams(fileUrl);
            if (params.file) {
                filename = params.file.substr(params.file.lastIndexOf('/') + 1);
            } else {
                // 'file' param not found. Extract what's after the last '/' without params.
                filename = this.urlUtils.getLastFileWithoutParams(fileUrl);
            }

        } else if (this.urlUtils.isGravatarUrl(fileUrl)) {
            // Extract gravatar ID.
            filename = 'gravatar_' + this.urlUtils.getLastFileWithoutParams(fileUrl);
        } else if (this.urlUtils.isThemeImageUrl(fileUrl)) {
            // Extract user ID.
            const matches = fileUrl.match(/\/core\/([^\/]*)\//);
            if (matches && matches[1]) {
                filename = matches[1];
            }
            // Attach a constant and the image type.
            filename = 'default_' + filename + '_' + this.urlUtils.getLastFileWithoutParams(fileUrl);
        } else {
            // Another URL. Just get what's after the last /.
            filename = this.urlUtils.getLastFileWithoutParams(fileUrl);
        }

        // If there are hashes in the URL, extract them.
        const index = filename.indexOf('#');
        let hashes;

        if (index != -1) {
            hashes = filename.split('#');

            // Remove the URL from the array.
            hashes.shift();

            filename = filename.substr(0, index);
        }

        // Remove the extension from the filename.
        filename = this.mimeUtils.removeExtension(filename);

        if (hashes) {
            // Add hashes to the name.
            filename += '_' + hashes.join('_');
        }

        return this.textUtils.removeSpecialCharactersForFiles(filename);
    }

    /**
     * Check if the file is already in the pool. This does not check if the file is on the disk.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved with file object from DB on success, rejected otherwise.
     */
    protected hasFileInPool(siteId: string, fileId: string): Promise<CoreFilepoolFileEntry> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return db.getRecord(this.FILES_TABLE, { fileId: fileId }).then((entry) => {
                if (typeof entry === 'undefined') {
                    return Promise.reject(null);
                }

                return entry;
            });
        });
    }

    /**
     * Check if the file is in the queue.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved with file object from DB on success, rejected otherwise.
     */
    protected async hasFileInQueue(siteId: string, fileId: string): Promise<CoreFilepoolQueueEntry> {
        await this.dbReady;

        const entry = await this.appDB.getRecord(this.QUEUE_TABLE, { siteId: siteId, fileId: fileId });
        if (typeof entry === 'undefined') {
            throw null;
        }
        // Convert the links to an object.
        entry.links = this.textUtils.parseJSON(entry.links, []);

        return entry;
    }

    /**
     * Invalidate all the files in a site.
     *
     * @param siteId The site ID.
     * @param onlyUnknown True to only invalidate files from external repos or without revision/timemodified.
     *                    It is advised to set it to true to reduce the performance and data usage of the app.
     * @return Resolved on success.
     */
    invalidateAllFiles(siteId: string, onlyUnknown: boolean = true): Promise<any> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            let where,
                whereParams;
            if (onlyUnknown) {
                where = 'isexternalfile = ? OR (revision < ? AND timemodified = ?)';
                whereParams = [0, 1, 0];
            }

            return db.updateRecordsWhere(this.FILES_TABLE, { stale: 1 }, where, whereParams);
        });
    }

    /**
     * Invalidate a file by URL.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved on success.
     * @description
     * Invalidates a file by marking it stale. It will not be added to the queue automatically, but the next time this file
     * is requested it will be added to the queue.
     * You can manully call addToQueueByUrl to add this file to the queue immediately.
     * Please note that, if a file is stale, the user will be presented the stale file if there is no network access.
     */
    invalidateFileByUrl(siteId: string, fileUrl: string): Promise<any> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.sitesProvider.getSiteDb(siteId).then((db) => {
                return db.updateRecords(this.FILES_TABLE, { stale: 1 }, { fileId: fileId });
            });
        });
    }

    /**
     * Invalidate all the matching files from a component.
     *
     * @param siteId The site ID.
     * @param component The component to invalidate.
     * @param componentId An ID to use in conjunction with the component.
     * @param onlyUnknown True to only invalidate files from external repos or without revision/timemodified.
     *                    It is advised to set it to true to reduce the performance and data usage of the app.
     * @return Resolved when done.
     */
    invalidateFilesByComponent(siteId: string, component: string, componentId?: string | number, onlyUnknown: boolean = true)
            : Promise<any> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return this.getComponentFiles(db, component, componentId).then((items) => {
                const fileIds = items.map((item) => {
                        return item.fileId;
                    }),
                    whereAndParams = db.getInOrEqual(fileIds);

                whereAndParams[0] = 'fileId ' + whereAndParams[0];

                if (onlyUnknown) {
                    whereAndParams[0] += ' AND (isexternalfile = ? OR (revision < ? AND timemodified = ?))';
                    whereAndParams[1] = whereAndParams[1].concat([0, 1, 0]);
                }

                return db.updateRecordsWhere(this.FILES_TABLE, { stale: 1 }, whereAndParams[0], whereAndParams[1]);
            });
        });
    }

    /**
     * Whether a file action indicates a file was downloaded or deleted.
     *
     * @param data Event data.
     * @return Whether downloaded or deleted.
     */
    isFileEventDownloadedOrDeleted(data: CoreFilepoolFileEventData): boolean {
        return (data.action == CoreFilepoolFileActions.DOWNLOAD && data.success == true) ||
                data.action == CoreFilepoolFileActions.DELETED;
    }

    /**
     * Check whether a file is downloadable.
     *
     * @param siteId The site ID.
     * @param fileUrl File URL.
     * @param timemodified The time this file was modified.
     * @param filePath Filepath to download the file to. If defined, no extension will be added.
     * @param revision File revision. If not defined, it will be calculated using the URL.
     * @return Promise resolved with a boolean: whether a file is downloadable.
     */
    async isFileDownloadable(siteId: string, fileUrl: string, timemodified: number = 0, filePath?: string, revision?: number)
            : Promise<boolean> {
        const state = await this.getFileStateByUrl(siteId, fileUrl, timemodified, filePath, revision);

        return state != CoreConstants.NOT_DOWNLOADABLE;
    }

    /**
     * Check if a file is downloading.
     *
     * @param siteId The site ID.
     * @param fileUrl File URL.
     * @param Promise resolved if file is downloading, rejected otherwise.
     */
    isFileDownloadingByUrl(siteId: string, fileUrl: string): Promise<any> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.hasFileInQueue(siteId, fileId);
        });
    }

    /**
     * Check if a file is outdated.
     *
     * @param entry Filepool entry.
     * @param revision File revision number.
     * @param timemodified The time this file was modified.
     * @param Whether the file is outdated.
     */
    protected isFileOutdated(entry: CoreFilepoolFileEntry, revision?: number, timemodified?: number): boolean {
        return !!entry.stale || revision > entry.revision || timemodified > entry.timemodified;
    }

    /**
     * Check if cannot determine if a file has been updated.
     *
     * @param entry Filepool entry.
     * @return Whether it cannot determine updates.
     */
    protected isFileUpdateUnknown(entry: CoreFilepoolFileEntry): boolean {
        return !!entry.isexternalfile || (entry.revision < 1 && !entry.timemodified);
    }

    /**
     * Notify an action performed on a file to a list of components.
     *
     * @param siteId The site ID.
     * @param eventData The file event data.
     * @param links The links to the components.
     */
    protected notifyFileActionToComponents(siteId: string, eventData: CoreFilepoolFileEventData,
            links: CoreFilepoolComponentLink[]): void {

        links.forEach((link) => {
            const data: CoreFilepoolComponentFileEventData = Object.assign({
                component: link.component,
                componentId: link.componentId,
            }, eventData);

            this.eventsProvider.trigger(CoreEventsProvider.COMPONENT_FILE_ACTION, data, siteId);
        });
    }

    /**
     * Notify a file has been deleted.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links The links to components.
     */
    protected notifyFileDeleted(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): void {
        const data: CoreFilepoolFileEventData = {
            fileId: fileId,
            action: CoreFilepoolFileActions.DELETED,
        };

        this.eventsProvider.trigger(this.getFileEventName(siteId, fileId), data);
        this.notifyFileActionToComponents(siteId, data, links);
    }

    /**
     * Notify a file has been downloaded.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links The links to components.
     */
    protected notifyFileDownloaded(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): void {
        const data: CoreFilepoolFileEventData = {
            fileId: fileId,
            action: CoreFilepoolFileActions.DOWNLOAD,
            success: true,
        };

        this.eventsProvider.trigger(this.getFileEventName(siteId, fileId), data);
        this.notifyFileActionToComponents(siteId, data, links);
    }

    /**
     * Notify error occurred while downloading a file.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links The links to components.
     */
    protected notifyFileDownloadError(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): void {
        const data: CoreFilepoolFileEventData = {
            fileId: fileId,
            action: CoreFilepoolFileActions.DOWNLOAD,
            success: false,
        };

        this.eventsProvider.trigger(this.getFileEventName(siteId, fileId), data);
        this.notifyFileActionToComponents(siteId, data, links);
    }

    /**
     * Notify a file starts being downloaded or added to queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links The links to components.
     */
    protected notifyFileDownloading(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): void {
        const data: CoreFilepoolFileEventData = {
            fileId: fileId,
            action: CoreFilepoolFileActions.DOWNLOADING,
        };

        this.eventsProvider.trigger(this.getFileEventName(siteId, fileId), data);
        this.notifyFileActionToComponents(siteId, data, links);

    }

    /**
     * Notify a file has been outdated.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param links The links to components.
     */
    protected notifyFileOutdated(siteId: string, fileId: string, links: CoreFilepoolComponentLink[]): void {
        const data: CoreFilepoolFileEventData = {
            fileId: fileId,
            action: CoreFilepoolFileActions.OUTDATED,
        };

        this.eventsProvider.trigger(this.getFileEventName(siteId, fileId), data);
        this.notifyFileActionToComponents(siteId, data, links);
    }

    /**
     * Prefetches a list of files.
     *
     * @param siteId The site ID.
     * @param fileList List of files to download.
     * @param component The component to link the file to.
     * @param componentId An ID to identify the download.
     * @param extra Extra data to store for the package.
     * @param dirPath Name of the directory where to store the files (inside filepool dir). If not defined, store
     *                the files directly inside the filepool folder.
     * @param onProgress Function to call on progress.
     * @return Promise resolved when all files are downloaded.
     */
    prefetchPackage(siteId: string, fileList: any[], component: string, componentId?: string | number, extra?: string,
            dirPath?: string, onProgress?: (event: any) => any): Promise<any> {
        return this.downloadOrPrefetchPackage(siteId, fileList, true, component, componentId, extra, dirPath, onProgress);
    }

    /**
     * Process the queue.
     *
     * @description
     * This loops over itself to keep on processing the queue in the background.
     * The queue process is site agnostic.
     */
    protected processQueue(): void {
        let promise;

        if (this.queueState !== this.QUEUE_RUNNING) {
            // Silently ignore, the queue is on pause.
            promise = Promise.reject(this.ERR_QUEUE_ON_PAUSE);

        } else if (!this.fileProvider.isAvailable() || !this.appProvider.isOnline()) {
            promise = Promise.reject(this.ERR_FS_OR_NETWORK_UNAVAILABLE);

        } else {
            promise = this.processImportantQueueItem();
        }

        promise.then(() => {
            // All good, we schedule next execution.
            setTimeout(() => {
                this.processQueue();
            }, this.QUEUE_PROCESS_INTERVAL);

        }, (error) => {

            // We had an error, in which case we pause the processing.
            if (error === this.ERR_FS_OR_NETWORK_UNAVAILABLE) {
                this.logger.debug('Filesysem or network unavailable, pausing queue processing.');

            } else if (error === this.ERR_QUEUE_IS_EMPTY) {
                this.logger.debug('Queue is empty, pausing queue processing.');
            }

            this.queueState = this.QUEUE_PAUSED;
        });
    }

    /**
     * Process the most important queue item.
     *
     * @return Resolved on success. Rejected on failure.
     */
    protected async processImportantQueueItem(): Promise<any> {
        await this.dbReady;

        let items;

        try {
            items = await this.appDB.getRecords(this.QUEUE_TABLE, undefined, 'priority DESC, added ASC', undefined, 0, 1);
        } catch (err) {
            throw this.ERR_QUEUE_IS_EMPTY;
        }

        const item = items.pop();
        if (!item) {
            throw this.ERR_QUEUE_IS_EMPTY;
        }
        // Convert the links to an object.
        item.links = this.textUtils.parseJSON(item.links, []);

        return this.processQueueItem(item);
    }

    /**
     * Process a queue item.
     *
     * @param item The object from the queue store.
     * @return Resolved on success. Rejected on failure.
     */
    protected processQueueItem(item: CoreFilepoolQueueEntry): Promise<any> {
        // Cast optional fields to undefined instead of null.
        const siteId = item.siteId,
            fileId = item.fileId,
            fileUrl = item.url,
            options = {
                revision: item.revision || undefined,
                timemodified: item.timemodified || undefined,
                isexternalfile: item.isexternalfile || undefined,
                repositorytype: item.repositorytype || undefined
            },
            filePath = item.path || undefined,
            links = item.links || [];

        this.logger.debug('Processing queue item: ' + siteId + ', ' + fileId);

        // Check if the file is already in pool.
        return this.hasFileInPool(siteId, fileId).catch(() => {
            // File not in pool.
        }).then((entry: CoreFilepoolFileEntry) => {

            if (entry && !options.isexternalfile && !this.isFileOutdated(entry, options.revision, options.timemodified)) {
                // We have the file, it is not stale, we can update links and remove from queue.
                this.logger.debug('Queued file already in store, ignoring...');
                this.addFileLinks(siteId, fileId, links).catch(() => {
                    // Ignore errors.
                });
                this.removeFromQueue(siteId, fileId).catch(() => {
                    // Ignore errors.
                }).finally(() => {
                    this.treatQueueDeferred(siteId, fileId, true);
                });

                return;
            }

            // The file does not exist, or is stale, ... download it.
            const onProgress = this.getQueueOnProgress(siteId, fileId);

            return this.downloadForPoolByUrl(siteId, fileUrl, options, filePath, onProgress, entry).then(() => {
                // Success, we add links and remove from queue.
                this.addFileLinks(siteId, fileId, links).catch(() => {
                    // Ignore errors.
                });

                this.treatQueueDeferred(siteId, fileId, true);
                this.notifyFileDownloaded(siteId, fileId, links);

                // Wait for the item to be removed from queue before resolving the promise.
                // If the item could not be removed from queue we still resolve the promise.
                return this.removeFromQueue(siteId, fileId).catch(() => {
                    // Ignore errors.
                });
            }, (errorObject) => {
                // Whoops, we have an error...
                let dropFromQueue = false;

                if (errorObject && errorObject.source === fileUrl) {
                    // This is most likely a FileTransfer error.
                    if (errorObject.code === 1) { // FILE_NOT_FOUND_ERR.
                        // The file was not found, most likely a 404, we remove from queue.
                        dropFromQueue = true;
                    } else if (errorObject.code === 2) { // INVALID_URL_ERR.
                        // The URL is invalid, we drop the file from the queue.
                        dropFromQueue = true;
                    } else if (errorObject.code === 3) { // CONNECTION_ERR.
                        // If there was an HTTP status, then let's remove from the queue.
                        dropFromQueue = true;
                    } else if (errorObject.code === 4) { // ABORTED_ERR.
                        // The transfer was aborted, we will keep the file in queue.
                    } else if (errorObject.code === 5) { // NOT_MODIFIED_ERR.
                        // We have the latest version of the file, HTTP 304 status.
                        dropFromQueue = true;
                    } else {
                        // Unknown error, let's remove the file from the queue to avoi locking down the queue.
                        dropFromQueue = true;
                    }
                } else {
                    dropFromQueue = true;
                }

                let errorMessage = null;
                // Some Android devices restrict the amount of usable storage using quotas.
                // If this quota would be exceeded by the download, it throws an exception.
                // We catch this exception here, and report a meaningful error message to the user.
                if (errorObject instanceof FileTransferError && errorObject.exception && errorObject.exception.includes('EDQUOT')) {
                    errorMessage = 'core.course.insufficientavailablequota';
                }

                if (dropFromQueue) {
                    this.logger.debug('Item dropped from queue due to error: ' + fileUrl, errorObject);

                    return this.removeFromQueue(siteId, fileId).catch(() => {
                        // Consider this as a silent error, never reject the promise here.
                    }).then(() => {
                        this.treatQueueDeferred(siteId, fileId, false, errorMessage);
                        this.notifyFileDownloadError(siteId, fileId, links);
                    });
                } else {
                    // We considered the file as legit but did not get it, failure.
                    this.treatQueueDeferred(siteId, fileId, false, errorMessage);
                    this.notifyFileDownloadError(siteId, fileId, links);

                    return Promise.reject(errorObject);
                }

            });
        });
    }

    /**
     * Remove a file from the queue.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     */
    protected async removeFromQueue(siteId: string, fileId: string): Promise<any> {
        await this.dbReady;

        return this.appDB.deleteRecords(this.QUEUE_TABLE, { siteId: siteId, fileId: fileId });
    }

    /**
     * Remove a file from the pool.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @return Resolved on success.
     */
    protected removeFileById(siteId: string, fileId: string): Promise<any> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            // Get the path to the file first since it relies on the file object stored in the pool.
            // Don't use getFilePath to prevent performing 2 DB requests.
            let path = this.getFilepoolFolderPath(siteId) + '/' + fileId,
                fileUrl;

            return this.hasFileInPool(siteId, fileId).then((entry) => {
                fileUrl = entry.url;

                if (entry.extension) {
                    path += '.' + entry.extension;
                }

                return path;
            }).catch(() => {
                // If file not found, use the path without extension.
                return path;
            }).then((path) => {
                const conditions = {
                    fileId: fileId
                };

                // Get links to components to notify them after remove.
                return this.getFileLinks(siteId, fileId).then((links) => {
                    const promises = [];

                    // Remove entry from filepool store.
                    promises.push(db.deleteRecords(this.FILES_TABLE, conditions));

                    // Remove links.
                    promises.push(db.deleteRecords(this.LINKS_TABLE, conditions));

                    // Remove the file.
                    if (this.fileProvider.isAvailable()) {
                        promises.push(this.fileProvider.removeFile(path).catch((error) => {
                            if (error && error.code == 1) {
                                // Not found, ignore error since maybe it was deleted already.
                            } else {
                                return Promise.reject(error);
                            }
                        }));
                    }

                    return Promise.all(promises).then(() => {
                        this.notifyFileDeleted(siteId, fileId, links);

                        return this.pluginFileDelegate.fileDeleted(fileUrl, path, siteId).catch((error) => {
                            // Ignore errors.
                        });
                    });
                });
            });
        });
    }

    /**
     * Delete all the matching files from a component.
     *
     * @param siteId The site ID.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @return Resolved on success.
     */
    removeFilesByComponent(siteId: string, component: string, componentId?: string | number): Promise<any> {
        return this.sitesProvider.getSiteDb(siteId).then((db) => {
            return this.getComponentFiles(db, component, componentId);
        }).then((items) => {
            return Promise.all(items.map((item) => {
                return this.removeFileById(siteId, item.fileId);
            }));
        });
    }

    /**
     * Remove a file from the pool.
     *
     * @param siteId The site ID.
     * @param fileUrl The file URL.
     * @return Resolved on success, rejected on failure.
     */
    removeFileByUrl(siteId: string, fileUrl: string): Promise<any> {
        return this.fixPluginfileURL(siteId, fileUrl).then((file) => {
            const fileId = this.getFileIdByUrl(file.fileurl);

            return this.removeFileById(siteId, fileId);
        });
    }

    /**
     * Removes the revision number from a file URL.
     *
     * @param url URL to remove the revision number.
     * @return URL without revision number.
     * @description
     * The revision is used to know if a file has changed. We remove it from the URL to prevent storing a file per revision.
     */
    protected removeRevisionFromUrl(url: string): string {
        const args = this.getPluginFileArgs(url);
        if (!args) {
            // Not a pluginfile, no revision will be found.
            return url;
        }

        return this.pluginFileDelegate.removeRevisionFromUrl(url, args);
    }

    /**
     * Change the package status, setting it to the previous status.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved when the status is changed. Resolve param: new status.
     */
    setPackagePreviousStatus(siteId: string, component: string, componentId?: string | number): Promise<any> {
        componentId = this.fixComponentId(componentId);
        this.logger.debug(`Set previous status for package ${component} ${componentId}`);

        return this.sitesProvider.getSite(siteId).then((site) => {
            const packageId = this.getPackageId(component, componentId);

            // Get current stored data, we'll only update 'status' and 'updated' fields.
            return site.getDb().getRecord(this.PACKAGES_TABLE, { id: packageId }).then((entry: CoreFilepoolPackageEntry) => {
                const newData: CoreFilepoolPackageEntry = {};
                if (entry.status == CoreConstants.DOWNLOADING) {
                    // Going back from downloading to previous status, restore previous download time.
                    newData.downloadTime = entry.previousDownloadTime;
                }
                newData.status = entry.previous || CoreConstants.NOT_DOWNLOADED;
                newData.updated = Date.now();
                this.logger.debug(`Set previous status '${entry.status}' for package ${component} ${componentId}`);

                return site.getDb().updateRecords(this.PACKAGES_TABLE, newData, { id: packageId }).then(() => {
                    // Success updating, trigger event.
                    this.triggerPackageStatusChanged(site.id, newData.status, component, componentId);

                    return newData.status;
                });
            });
        });
    }

    /**
     * Check if a file should be downloaded based on its size.
     *
     * @param size File size.
     * @return Whether file should be downloaded.
     */
    shouldDownload(size: number): boolean {
        return size <= this.DOWNLOAD_THRESHOLD || (this.appProvider.isWifi() && size <= this.WIFI_DOWNLOAD_THRESHOLD);
    }

    /**
     * Convenience function to check if a file should be downloaded before opening it.
     *
     * @param url File online URL.
     * @param size File size.
     * @return Promise resolved if should download before open, rejected otherwise.
     * @description
     * Convenience function to check if a file should be downloaded before opening it.
     *
     * The default behaviour in the app is to download first and then open the local file in the following cases:
     *     - The file is small (less than DOWNLOAD_THRESHOLD).
     *     - The file cannot be streamed.
     * If the file is big and can be streamed, the promise returned by this function will be rejected.
     */
    shouldDownloadBeforeOpen(url: string, size: number): Promise<any> {
        if (size >= 0 && size <= this.DOWNLOAD_THRESHOLD) {
            // The file is small, download it.
            return Promise.resolve();
        }

        if (this.appProvider.isDesktop()) {
            // In desktop always download first.
            return Promise.resolve();
        }

        return this.utils.getMimeTypeFromUrl(url).then((mimetype) => {
            // If the file is streaming (audio or video) we reject.
            if (mimetype.indexOf('video') != -1 || mimetype.indexOf('audio') != -1) {
                return Promise.reject(null);
            }
        });
    }

    /**
     * Store package status.
     *
     * @param siteId Site ID.
     * @param status New package status.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @param extra Extra data to store for the package. If you want to store more than 1 value, use JSON.stringify.
     * @return Promise resolved when status is stored.
     */
    storePackageStatus(siteId: string, status: string, component: string, componentId?: string | number, extra?: string)
            : Promise<any> {
        this.logger.debug(`Set status '${status}' for package ${component} ${componentId}`);
        componentId = this.fixComponentId(componentId);

        return this.sitesProvider.getSite(siteId).then((site) => {
            const packageId = this.getPackageId(component, componentId);
            let downloadTime,
                previousDownloadTime;

            if (status == CoreConstants.DOWNLOADING) {
                // Set download time if package is now downloading.
                downloadTime = this.timeUtils.timestamp();
            }

            // Search current status to set it as previous status.
            return site.getDb().getRecord(this.PACKAGES_TABLE, { id: packageId }).then((entry: CoreFilepoolPackageEntry) => {
                if (typeof extra == 'undefined' || extra === null) {
                    extra = entry.extra;
                }
                if (typeof downloadTime == 'undefined') {
                    // Keep previous download time.
                    downloadTime = entry.downloadTime;
                    previousDownloadTime = entry.previousDownloadTime;
                } else {
                    // The downloadTime will be updated, store current time as previous.
                    previousDownloadTime = entry.downloadTime;
                }

                return entry.status;
            }).catch(() => {
                // No previous status.
            }).then((previousStatus: string) => {
                const packageEntry: CoreFilepoolPackageEntry = {
                        id: packageId,
                        component: component,
                        componentId: componentId,
                        status: status,
                        previous: previousStatus,
                        updated: Date.now(),
                        downloadTime: downloadTime,
                        previousDownloadTime: previousDownloadTime,
                        extra: extra
                    };
                let promise;

                if (previousStatus === status) {
                    // The package already has this status, no need to change it.
                    promise = Promise.resolve();
                } else {
                    promise = site.getDb().insertRecord(this.PACKAGES_TABLE, packageEntry);
                }

                return promise.then(() => {
                    // Success inserting, trigger event.
                    this.triggerPackageStatusChanged(siteId, status, component, componentId);
                });
            });
        });
    }

    /**
     * Search for files in a CSS code and try to download them. Once downloaded, replace their URLs
     * and store the result in the CSS file.
     *
     * @param siteId Site ID.
     * @param fileUrl CSS file URL.
     * @param cssCode CSS code.
     * @param component The component to link the file to.
     * @param componentId An ID to use in conjunction with the component.
     * @param revision Revision to use in all files. If not defined, it will be calculated using the URL of each file.
     * @return Promise resolved with the CSS code.
     */
    treatCSSCode(siteId: string, fileUrl: string, cssCode: string, component?: string, componentId?: string | number,
            revision?: number): Promise<string> {

        const urls = this.domUtils.extractUrlsFromCSS(cssCode),
            promises = [];
        let filePath,
            updated = false;

        // Get the path of the CSS file.
        promises.push(this.getFilePathByUrl(siteId, fileUrl).then((path) => {
            filePath = path;
        }));

        urls.forEach((url) => {
            // Download the file only if it's an online URL.
            if (!this.urlUtils.isLocalFileUrl(url)) {
                promises.push(this.downloadUrl(siteId, url, false, component, componentId, 0, undefined, undefined, undefined,
                        revision).then((fileUrl) => {

                    if (fileUrl != url) {
                        cssCode = cssCode.replace(new RegExp(this.textUtils.escapeForRegex(url), 'g'), fileUrl);
                        updated = true;
                    }
                }).catch((error) => {
                    // It shouldn't happen. Ignore errors.
                    this.logger.warn('Error treating file ', url, error);
                }));
            }
        });

        return Promise.all(promises).then(() => {
            // All files downloaded. Store the result if it has changed.
            if (updated) {
                return this.fileProvider.writeFile(filePath, cssCode);
            }
        }).then(() => {
            return cssCode;
        });
    }

    /**
     * Resolves or rejects a queue deferred and removes it from the list.
     *
     * @param siteId The site ID.
     * @param fileId The file ID.
     * @param resolve True if promise should be resolved, false if it should be rejected.
     * @param error String identifier for error message, if rejected.
     */
    protected treatQueueDeferred(siteId: string, fileId: string, resolve: boolean, error?: string): void {
        if (this.queueDeferreds[siteId] && this.queueDeferreds[siteId][fileId]) {
            if (resolve) {
                this.queueDeferreds[siteId][fileId].resolve();
            } else {
                this.queueDeferreds[siteId][fileId].reject(error);
            }
            delete this.queueDeferreds[siteId][fileId];
        }
    }

    /**
     * Trigger mmCoreEventPackageStatusChanged with the right data.
     *
     * @param siteId Site ID.
     * @param status New package status.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     */
    protected triggerPackageStatusChanged(siteId: string, status: string, component: string, componentId?: string | number): void {
        const data = {
            component: component,
            componentId: this.fixComponentId(componentId),
            status: status
        };
        this.eventsProvider.trigger(CoreEventsProvider.PACKAGE_STATUS_CHANGED, data, siteId);
    }

    /**
     * Update the download time of a package. This doesn't modify the previous download time.
     * This function should be used if a package generates some new data during a download. Calling this function
     * right after generating the data in the download will prevent detecting this data as an update.
     *
     * @param siteId Site ID.
     * @param component Package's component.
     * @param componentId An ID to use in conjunction with the component.
     * @return Promise resolved when status is stored.
     */
    updatePackageDownloadTime(siteId: string, component: string, componentId?: string | number): Promise<any> {
        componentId = this.fixComponentId(componentId);

        return this.sitesProvider.getSite(siteId).then((site) => {
            const packageId = this.getPackageId(component, componentId);

            return site.getDb().updateRecords(this.PACKAGES_TABLE, { downloadTime: this.timeUtils.timestamp() }, { id: packageId });
        });
    }
}

export class CoreFilepool extends makeSingleton(CoreFilepoolProvider) {}
