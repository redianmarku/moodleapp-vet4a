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
import { CoreApp } from '@providers/app';
import { CoreSites } from '@providers/sites';
import { CoreTextUtils } from '@providers/utils/text';
import { CoreUtils } from '@providers/utils/utils';
import { CoreSite } from '@classes/site';
import { CoreXAPIOffline, CoreXAPIOfflineSaveStatementsOptions } from './offline';

import { makeSingleton } from '@singletons/core.singletons';

/**
 * Service to provide XAPI functionalities.
 */
@Injectable()
export class CoreXAPIProvider {

    protected ROOT_CACHE_KEY = 'CoreXAPI:';

    /**
     * Returns whether or not WS to post XAPI statement is available.
     *
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved with true if ws is available, false otherwise.
     * @since 3.9
     */
    async canPostStatements(siteId?: string): Promise<boolean> {
        const site = await CoreSites.instance.getSite(siteId);

        return this.canPostStatementsInSite(site);
    }

    /**
     * Returns whether or not WS to post XAPI statement is available in a certain site.
     *
     * @param site Site. If not defined, current site.
     * @return Promise resolved with true if ws is available, false otherwise.
     * @since 3.9
     */
    canPostStatementsInSite(site?: CoreSite): boolean {
        site = site || CoreSites.instance.getCurrentSite();

        return site.wsAvailable('core_xapi_statement_post');
    }

    /**
     * Get URL for XAPI events.
     *
     * @param contextId Context ID.
     * @param type Type (e.g. 'activity').
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when done.
     */
    async getUrl(contextId: number, type: string, siteId?: string): Promise<string> {
        const site = await CoreSites.instance.getSite(siteId);

        return CoreTextUtils.instance.concatenatePaths(site.getURL(), `xapi/${type}/${contextId}`);
    }

    /**
     * Post statements.
     *
     * @param contextId Context ID.
     * @param component Component.
     * @param json JSON string to send.
     * @param options Options.
     * @return Promise resolved with boolean: true if response was sent to server, false if stored in device.
     */
    async postStatements(contextId: number, component: string, json: string, options?: CoreXAPIPostStatementsOptions)
            : Promise<boolean> {

        options = options || {};
        options.siteId = options.siteId || CoreSites.instance.getCurrentSiteId();

        // Convenience function to store a message to be synchronized later.
        const storeOffline = async (): Promise<boolean> => {
            await CoreXAPIOffline.instance.saveStatements(contextId, component, json, options);

            return false;
        };

        if (!CoreApp.instance.isOnline() || options.offline) {
            // App is offline, store the action.
            return storeOffline();
        }

        try {
            await this.postStatementsOnline(component, json, options.siteId);

            return true;
        } catch (error) {
            if (CoreUtils.instance.isWebServiceError(error)) {
                // The WebService has thrown an error, this means that responses cannot be submitted.
                throw error;
            } else {
                // Couldn't connect to server, store it offline.
                return storeOffline();
            }
        }
    }

    /**
     * Post statements. It will fail if offline or cannot connect.
     *
     * @param component Component.
     * @param json JSON string to send.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when done.
     */
    async postStatementsOnline(component: string, json: string, siteId?: string): Promise<number[]> {

        const site = await CoreSites.instance.getSite(siteId);

        const data = {
            component: component,
            requestjson: json,
        };

        return site.write('core_xapi_statement_post', data);
    }
}

export class CoreXAPI extends makeSingleton(CoreXAPIProvider) {}

/**
 * Options to pass to postStatements function.
 */
export type CoreXAPIPostStatementsOptions = CoreXAPIOfflineSaveStatementsOptions & {
    offline?: boolean; // Whether to force storing it in offline.
};
