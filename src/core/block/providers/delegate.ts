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

import { Injectable, Injector } from '@angular/core';
import { CoreLoggerProvider } from '@providers/logger';
import { CoreEventsProvider } from '@providers/events';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDelegate, CoreDelegateHandler } from '@classes/delegate';
import { CoreBlockDefaultHandler } from './default-block-handler';
import { CoreSite } from '@classes/site';
import { CoreSitePluginsProvider } from '@core/siteplugins/providers/siteplugins';
import { Subject } from 'rxjs';

/**
 * Interface that all blocks must implement.
 */
export interface CoreBlockHandler extends CoreDelegateHandler {
    /**
     * Name of the block the handler supports. E.g. 'activity_modules'.
     */
    blockName: string;

    /**
     * Returns the data needed to render the block.
     *
     * @param injector Injector.
     * @param block The block to render.
     * @param contextLevel The context where the block will be used.
     * @param instanceId The instance ID associated with the context level.
     * @return Data or promise resolved with the data.
     */
    getDisplayData?(injector: Injector, block: any, contextLevel: string, instanceId: number)
            : CoreBlockHandlerData | Promise<CoreBlockHandlerData>;
}

/**
 * Data needed to render a block. It's returned by the handler.
 */
export interface CoreBlockHandlerData {
    /**
     * Title to display for the block.
     */
    title: string;

    /**
     * Class to add to the displayed block.
     */
    class?: string;

    /**
     * The component to render the contents of the block.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     */
    component: any;

    /**
     * Data to pass to the component. All the properties in this object will be passed to the component as inputs.
     */
    componentData?: any;

    /**
     * Link to go when showing only title.
     */
    link?: string;

    /**
     * Params of the link.
     */
    linkParams?: any;
}

/**
 * Delegate to register block handlers.
 */
@Injectable()
export class CoreBlockDelegate extends CoreDelegate {

    protected handlerNameProperty = 'blockName';

    protected featurePrefix = 'CoreBlockDelegate_';

    blocksUpdateObservable: Subject<void>;

    constructor(logger: CoreLoggerProvider, sitesProvider: CoreSitesProvider, eventsProvider: CoreEventsProvider,
            protected defaultHandler: CoreBlockDefaultHandler, protected sitePluginsProvider: CoreSitePluginsProvider) {
        super('CoreBlockDelegate', logger, sitesProvider, eventsProvider);
        this.blocksUpdateObservable = new Subject<void>();
    }

    /**
     * Check if blocks are disabled in a certain site.
     *
     * @param site Site. If not defined, use current site.
     * @return Whether it's disabled.
     */
    areBlocksDisabledInSite(site?: CoreSite): boolean {
        site = site || this.sitesProvider.getCurrentSite();

        return site.isFeatureDisabled('NoDelegate_SiteBlocks');
    }

    /**
     * Check if blocks are disabled in a certain site for courses.
     *
     * @param site Site. If not defined, use current site.
     * @return Whether it's disabled.
     */
    areBlocksDisabledInCourses(site?: CoreSite): boolean {
        site = site || this.sitesProvider.getCurrentSite();

        return site.isFeatureDisabled('NoDelegate_CourseBlocks');
    }

    /**
     * Check if blocks are disabled in a certain site.
     *
     * @param siteId Site Id. If not defined, use current site.
     * @return Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    areBlocksDisabled(siteId?: string): Promise<boolean> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return this.areBlocksDisabledInSite(site);
        });
    }

    /**
     * Get the display data for a certain block.
     *
     * @param injector Injector.
     * @param block The block to render.
     * @param contextLevel The context where the block will be used.
     * @param instanceId The instance ID associated with the context level.
     * @return Promise resolved with the display data.
     */
    getBlockDisplayData(injector: Injector, block: any, contextLevel: string, instanceId: number): Promise<CoreBlockHandlerData> {
        return Promise.resolve(this.executeFunctionOnEnabled(block.name, 'getDisplayData',
            [injector, block, contextLevel, instanceId]));
    }

    /**
     * Check if any of the blocks in a list is supported.
     *
     * @param blocks The list of blocks.
     * @return Whether any of the blocks is supported.
     */
    hasSupportedBlock(blocks: any[]): boolean {
        blocks = blocks || [];

        return !!blocks.find((block) => { return this.isBlockSupported(block.name); });
    }

    /**
     * Check if a block is supported.
     *
     * @param name Block "name". E.g. 'activity_modules'.
     * @return Whether it's supported.
     */
    isBlockSupported(name: string): boolean {
        return this.hasHandler(name, true);
    }

    /**
     * Check if feature is enabled or disabled in the site, depending on the feature prefix and the handler name.
     *
     * @param handler Handler to check.
     * @param site Site to check.
     * @return Whether is enabled or disabled in site.
     */
    protected isFeatureDisabled(handler: CoreDelegateHandler, site: CoreSite): boolean {
        return this.areBlocksDisabledInSite(site) || super.isFeatureDisabled(handler, site);
    }

    /**
     * Called when there are new block handlers available. Informs anyone who subscribed to the
     * observable.
     */
    updateData(): void {
        this.blocksUpdateObservable.next();
    }
}
