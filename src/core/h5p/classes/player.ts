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

import { CoreFile } from '@providers/file';
import { CoreSites } from '@providers/sites';
import { CoreTextUtils } from '@providers/utils/text';
import { CoreUrlUtils } from '@providers/utils/url';
import { CoreUtils } from '@providers/utils/utils';
import { CoreXAPI } from '@core/xapi/providers/xapi';
import { CoreH5P } from '../providers/h5p';
import { CoreH5PCore, CoreH5PDisplayOptions, CoreH5PContentData, CoreH5PDependenciesFiles } from './core';
import { CoreH5PHelper } from './helper';
import { CoreH5PStorage } from './storage';

/**
 * Equivalent to Moodle's H5P player class.
 */
export class CoreH5PPlayer {

    constructor(protected h5pCore: CoreH5PCore,
            protected h5pStorage: CoreH5PStorage) { }

    /**
     * Calculate the URL to the site H5P player.
     *
     * @param siteUrl Site URL.
     * @param fileUrl File URL.
     * @param displayOptions Display options.
     * @param component Component to send xAPI events to.
     * @return URL.
     */
    calculateOnlinePlayerUrl(siteUrl: string, fileUrl: string, displayOptions?: CoreH5PDisplayOptions, component?: string): string {
        fileUrl = CoreH5P.instance.treatH5PUrl(fileUrl, siteUrl);

        const params = this.getUrlParamsFromDisplayOptions(displayOptions);
        params.url = encodeURIComponent(fileUrl);
        if (component) {
            params.component = component;
        }

        return CoreUrlUtils.instance.addParamsToUrl(CoreTextUtils.instance.concatenatePaths(siteUrl, '/h5p/embed.php'), params);
    }

    /**
     * Create the index.html to render an H5P package.
     * Part of the code of this function is equivalent to Moodle's add_assets_to_page function.
     *
     * @param id Content ID.
     * @param h5pUrl The URL of the H5P file.
     * @param content Content data.
     * @param embedType Embed type. The app will always use 'iframe'.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved with the URL of the index file.
     */
    async createContentIndex(id: number, h5pUrl: string, content: CoreH5PContentData, embedType: string, siteId?: string)
            : Promise<string> {

        const site = await CoreSites.instance.getSite(siteId);

        const contentId = this.getContentId(id);
        const basePath = CoreFile.instance.getBasePathInstant();
        const contentUrl = CoreFile.instance.convertFileSrc(CoreTextUtils.instance.concatenatePaths(
                    basePath, this.h5pCore.h5pFS.getContentFolderPath(content.folderName, site.getId())));

        // Create the settings needed for the content.
        const contentSettings = {
            library: CoreH5PCore.libraryToString(content.library),
            fullScreen: content.library.fullscreen,
            exportUrl: '', // We'll never display the download button, so we don't need the exportUrl.
            embedCode: this.getEmbedCode(site.getURL(), h5pUrl, true),
            resizeCode: this.getResizeCode(),
            title: content.slug,
            displayOptions: {},
            url: '', // It will be filled using dynamic params if needed.
            contentUrl: contentUrl,
            metadata: content.metadata,
            contentUserData: [
                {
                    state: '{}'
                }
            ]
        };

        // Get the core H5P assets, needed by the H5P classes to render the H5P content.
        const result = await this.getAssets(id, content, embedType, site.getId());

        result.settings.contents[contentId] = Object.assign(result.settings.contents[contentId], contentSettings);

        const indexPath = this.h5pCore.h5pFS.getContentIndexPath(content.folderName, siteId);
        let html = '<html><head><title>' + content.title + '</title>' +
                '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">';

        // Include the required CSS.
        result.cssRequires.forEach((cssUrl) => {
            html += '<link rel="stylesheet" type="text/css" href="' + cssUrl + '">';
        });

        // Add the settings.
        html += '<script type="text/javascript">var H5PIntegration = ' +
                JSON.stringify(result.settings).replace(/\//g, '\\/') + '</script>';

        // Add our own script to handle the params.
        html += '<script type="text/javascript" src="' + CoreTextUtils.instance.concatenatePaths(
                this.h5pCore.h5pFS.getCoreH5PPath(), 'moodle/js/params.js') + '"></script>';

        html += '</head><body>';

        // Include the required JS at the beginning of the body, like Moodle web does.
        // Load the embed.js to allow communication with the parent window.
        html += '<script type="text/javascript" src="' +
                CoreTextUtils.instance.concatenatePaths(this.h5pCore.h5pFS.getCoreH5PPath(), 'moodle/js/embed.js') + '"></script>';

        result.jsRequires.forEach((jsUrl) => {
            html += '<script type="text/javascript" src="' + jsUrl + '"></script>';
        });

        html += '<div class="h5p-iframe-wrapper">' +
                '<iframe id="h5p-iframe-' + id + '" class="h5p-iframe" data-content-id="' + id + '"' +
                    'style="height:1px; min-width: 100%" src="about:blank"></iframe>' +
                '</div></body>';

        const fileEntry = await CoreFile.instance.writeFile(indexPath, html);

        return fileEntry.toURL();
    }

    /**
     * Delete all content indexes of all sites from filesystem.
     *
     * @return Promise resolved when done.
     */
    async deleteAllContentIndexes(): Promise<void> {
        const siteIds = await CoreSites.instance.getSitesIds();

        await Promise.all(siteIds.map((siteId) => this.deleteAllContentIndexesForSite(siteId)));
    }

    /**
     * Delete all content indexes for a certain site from filesystem.
     *
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when done.
     */
    async deleteAllContentIndexesForSite(siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.instance.getCurrentSiteId();

        const records = await this.h5pCore.h5pFramework.getAllContentData(siteId);

        await Promise.all(records.map(async (record) => {
            try {
                await this.h5pCore.h5pFS.deleteContentIndex(record.foldername, siteId);
            } catch (err) {
                // Ignore errors, maybe the file doesn't exist.
            }
        }));
    }

    /**
     * Delete all package content data.
     *
     * @param fileUrl File URL.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when done.
     */
    async deleteContentByUrl(fileUrl: string, siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.instance.getCurrentSiteId();

        const data = await this.h5pCore.h5pFramework.getContentDataByUrl(fileUrl, siteId);

        await CoreUtils.instance.allPromises([
            this.h5pCore.h5pFramework.deleteContentData(data.id, siteId),

            this.h5pCore.h5pFS.deleteContentFolder(data.foldername, siteId),
        ]);
    }

    /**
     * Get the assets of a package.
     *
     * @param id Content id.
     * @param content Content data.
     * @param embedType Embed type.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved with the assets.
     */
    protected async getAssets(id: number, content: CoreH5PContentData, embedType: string, siteId?: string)
            : Promise<{settings: any, cssRequires: string[], jsRequires: string[]}> {

        siteId = siteId || CoreSites.instance.getCurrentSiteId();

        // Get core assets.
        const coreAssets = await CoreH5PHelper.getCoreAssets(siteId);

        const contentId = this.getContentId(id);
        const settings = coreAssets.settings;
        settings.contents = settings.contents || {};
        settings.contents[contentId] = settings.contents[contentId] || {};

        settings.moodleLibraryPaths = await this.h5pCore.getDependencyRoots(id);

        /* The filterParameters function should be called before getting the dependency files because it rebuilds content
           dependency cache. */
        settings.contents[contentId].jsonContent = await this.h5pCore.filterParameters(content, siteId);

        const files = await this.getDependencyFiles(id, content.folderName, siteId);

        // H5P checks the embedType in here, but we'll always use iframe so there's no need to do it.
        // JavaScripts and stylesheets will be loaded through h5p.js.
        settings.contents[contentId].scripts = this.h5pCore.getAssetsUrls(files.scripts);
        settings.contents[contentId].styles = this.h5pCore.getAssetsUrls(files.styles);

        return {
            settings: settings,
            cssRequires: coreAssets.cssRequires,
            jsRequires: coreAssets.jsRequires,
        };
    }

    /**
     * Get the identifier for the H5P content. This identifier is different than the ID stored in the DB.
     *
     * @param id Package ID.
     * @return Content identifier.
     */
    protected getContentId(id: number): string {
        return 'cid-' + id;
    }

    /**
     * Get the content index file.
     *
     * @param fileUrl URL of the H5P package.
     * @param displayOptions Display options.
     * @param component Component to send xAPI events to.
     * @param contextId Context ID where the H5P is. Required for tracking.
     * @param siteId The site ID. If not defined, current site.
     * @return Promise resolved with the file URL if exists, rejected otherwise.
     */
    async getContentIndexFileUrl(fileUrl: string, displayOptions?: CoreH5PDisplayOptions, component?: string, contextId?: number,
            siteId?: string): Promise<string> {

        siteId = siteId || CoreSites.instance.getCurrentSiteId();

        const path = await this.h5pCore.h5pFS.getContentIndexFileUrl(fileUrl, siteId);

        // Add display options and component to the URL.
        const data = await this.h5pCore.h5pFramework.getContentDataByUrl(fileUrl, siteId);

        displayOptions = this.h5pCore.fixDisplayOptions(displayOptions, data.id);

        const params = {
            displayOptions: JSON.stringify(displayOptions),
            component: component || '',
            trackingUrl: undefined,
        };

        if (contextId) {
            params.trackingUrl = await CoreXAPI.instance.getUrl(contextId, 'activity', siteId);
        }

        return CoreUrlUtils.instance.addParamsToUrl(path, params);
    }

    /**
     * Finds library dependencies files of a certain package.
     *
     * @param id Content id.
     * @param folderName Name of the folder of the content.
     * @param siteId The site ID. If not defined, current site.
     * @return Promise resolved with the files.
     */
    protected async getDependencyFiles(id: number, folderName: string, siteId?: string): Promise<CoreH5PDependenciesFiles> {

        const preloadedDeps = await CoreH5P.instance.h5pCore.loadContentDependencies(id, 'preloaded', siteId);

        return this.h5pCore.getDependenciesFiles(preloadedDeps, folderName,
                this.h5pCore.h5pFS.getExternalH5PFolderPath(siteId), siteId);
    }

    /**
     * Get display options from a URL params.
     *
     * @param params URL params.
     * @return Display options as object.
     */
    getDisplayOptionsFromUrlParams(params: {[name: string]: string}): CoreH5PDisplayOptions {
        const displayOptions: CoreH5PDisplayOptions = {};

        if (!params) {
            return displayOptions;
        }

        displayOptions[CoreH5PCore.DISPLAY_OPTION_DOWNLOAD] =
                CoreUtils.instance.isTrueOrOne(params[CoreH5PCore.DISPLAY_OPTION_DOWNLOAD]);
        displayOptions[CoreH5PCore.DISPLAY_OPTION_EMBED] =
                CoreUtils.instance.isTrueOrOne(params[CoreH5PCore.DISPLAY_OPTION_EMBED]);
        displayOptions[CoreH5PCore.DISPLAY_OPTION_COPYRIGHT] =
                CoreUtils.instance.isTrueOrOne(params[CoreH5PCore.DISPLAY_OPTION_COPYRIGHT]);
        displayOptions[CoreH5PCore.DISPLAY_OPTION_FRAME] = displayOptions[CoreH5PCore.DISPLAY_OPTION_DOWNLOAD] ||
                displayOptions[CoreH5PCore.DISPLAY_OPTION_EMBED] || displayOptions[CoreH5PCore.DISPLAY_OPTION_COPYRIGHT];
        displayOptions[CoreH5PCore.DISPLAY_OPTION_ABOUT] =
                !!this.h5pCore.h5pFramework.getOption(CoreH5PCore.DISPLAY_OPTION_ABOUT, true);

        return displayOptions;
    }

    /**
     * Embed code for settings.
     *
     * @param siteUrl The site URL.
     * @param h5pUrl The URL of the .h5p file.
     * @param embedEnabled Whether the option to embed the H5P content is enabled.
     * @return The HTML code to reuse this H5P content in a different place.
     */
    protected getEmbedCode(siteUrl: string, h5pUrl: string, embedEnabled?: boolean): string {
        if (!embedEnabled) {
            return '';
        }

        return '<iframe src="' + this.getEmbedUrl(siteUrl, h5pUrl) + '" allowfullscreen="allowfullscreen"></iframe>';
    }

    /**
     * Get the encoded URL for embeding an H5P content.
     *
     * @param siteUrl The site URL.
     * @param h5pUrl The URL of the .h5p file.
     * @return The embed URL.
     */
    protected getEmbedUrl(siteUrl: string, h5pUrl: string): string {
        return CoreTextUtils.instance.concatenatePaths(siteUrl, '/h5p/embed.php') + '?url=' + h5pUrl;
    }

    /**
     * Resizing script for settings.
     *
     * @return The HTML code with the resize script.
     */
    protected getResizeCode(): string {
        return '<script src="' + this.getResizerScriptUrl() + '"></script>';
    }

    /**
     * Get the URL to the resizer script.
     *
     * @return URL.
     */
    getResizerScriptUrl(): string {
        return CoreTextUtils.instance.concatenatePaths(this.h5pCore.h5pFS.getCoreH5PPath(), 'js/h5p-resizer.js');
    }

    /**
     * Get online player URL params from display options.
     *
     * @param options Display options.
     * @return Object with URL params.
     */
    getUrlParamsFromDisplayOptions(options: CoreH5PDisplayOptions): {[name: string]: string} {
        const params: {[name: string]: string} = {};

        if (!options) {
            return params;
        }

        params[CoreH5PCore.DISPLAY_OPTION_FRAME] = options[CoreH5PCore.DISPLAY_OPTION_FRAME] ? '1' : '0';
        params[CoreH5PCore.DISPLAY_OPTION_DOWNLOAD] = options[CoreH5PCore.DISPLAY_OPTION_DOWNLOAD] ? '1' : '0';
        params[CoreH5PCore.DISPLAY_OPTION_EMBED] = options[CoreH5PCore.DISPLAY_OPTION_EMBED] ? '1' : '0';
        params[CoreH5PCore.DISPLAY_OPTION_COPYRIGHT] = options[CoreH5PCore.DISPLAY_OPTION_COPYRIGHT] ? '1' : '0';

        return params;
    }
}
