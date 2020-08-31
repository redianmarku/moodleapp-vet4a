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

import { Injector } from '@angular/core';
import { AddonWorkshopAssessmentStrategyHandler } from '@addon/mod/workshop/providers/assessment-strategy-delegate';
import {
    CoreSitePluginsWorkshopAssessmentStrategyComponent
} from '../../components/workshop-assessment-strategy/workshop-assessment-strategy';

/**
 * Handler to display a workshop assessment strategy site plugin.
 */
export class CoreSitePluginsWorkshopAssessmentStrategyHandler implements AddonWorkshopAssessmentStrategyHandler {

    constructor(public name: string, public strategyName: string) { }

    /**
     * Return the Component to use to display the plugin data, either in read or in edit mode.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     *
     * @param injector Injector.
     * @param plugin The plugin object.
     * @param edit Whether the user is editing.
     * @return The component (or promise resolved with component) to use, undefined if not found.
     */
    getComponent(injector: Injector): any | Promise<any> {
        return CoreSitePluginsWorkshopAssessmentStrategyComponent;
    }

    /**
     * Prepare original values to be shown and compared.
     *
     * @param form Original data of the form.
     * @param workshopId WorkShop Id
     * @return Promise resolved with original values sorted.
     */
     getOriginalValues(form: any, workshopId: number): Promise<any[]> {
         return Promise.resolve([]);
     }

    /**
     * Check if the assessment data has changed for a certain submission and workshop for a this strategy plugin.
     *
     * @param originalValues Original values of the form.
     * @param currentValues Current values of the form.
     * @return True if data has changed, false otherwise.
     */
    hasDataChanged(originalValues: any[], currentValues: any[]): boolean {
        return false;
    }

    /**
     * Whether or not the handler is enabled on a site level.
     * @return Whether or not the handler is enabled on a site level.
     */
    isEnabled(): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Prepare assessment data to be sent to the server depending on the strategy selected.
     *
     * @param currentValues Current values of the form.
     * @param form Assessment form data.
     * @return Promise resolved with the data to be sent. Or rejected with the input errors object.
     */
    prepareAssessmentData(currentValues: any[], form: any): Promise<any> {
        return Promise.resolve({});
    }
}
