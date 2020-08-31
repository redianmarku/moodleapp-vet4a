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
import { Injector, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AddonModDataFieldHandler } from '../../../providers/fields-delegate';
import { AddonModDataFieldLatlongComponent } from '../component/latlong';

/**
 * Handler for latlong data field plugin.
 */
@Injectable()
export class AddonModDataFieldLatlongHandler implements AddonModDataFieldHandler {
    name = 'AddonModDataFieldLatlongHandler';
    type = 'latlong';

    constructor(private translate: TranslateService) { }

    /**
     * Return the Component to use to display the plugin data.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     *
     * @param injector Injector.
     * @param field The field object.
     * @return The component (or promise resolved with component) to use, undefined if not found.
     */
    getComponent(injector: Injector, plugin: any): any | Promise<any> {
        return AddonModDataFieldLatlongComponent;
    }

    /**
     * Get field search data in the input data.
     *
     * @param field Defines the field to be rendered.
     * @param inputData Data entered in the search form.
     * @return With name and value of the data to be sent.
     */
    getFieldSearchData(field: any, inputData: any): any {
        const fieldName = 'f_' + field.id;

        if (inputData[fieldName]) {
            return [{
                name: fieldName,
                value: inputData[fieldName]
            }];
        }

        return false;
    }

    /**
     * Get field edit data in the input data.
     *
     * @param field Defines the field to be rendered.
     * @param inputData Data entered in the edit form.
     * @return With name and value of the data to be sent.
     */
    getFieldEditData(field: any, inputData: any, originalFieldData: any): any {
        const fieldName = 'f_' + field.id;

        return [
            {
                fieldid: field.id,
                subfield: '0',
                value: inputData[fieldName + '_0'] || ''
            },
            {
                fieldid: field.id,
                subfield: '1',
                value: inputData[fieldName + '_1'] || ''
            }
        ];
    }

    /**
     * Get field data in changed.
     *
     * @param field Defines the field to be rendered.
     * @param inputData Data entered in the edit form.
     * @param originalFieldData Original field entered data.
     * @return If the field has changes.
     */
    hasFieldDataChanged(field: any, inputData: any, originalFieldData: any): Promise<boolean> | boolean {
        const fieldName = 'f_' + field.id,
            lat = inputData[fieldName + '_0'] || '',
            long = inputData[fieldName + '_1'] || '',
            originalLat = (originalFieldData && originalFieldData.content) || '',
            originalLong = (originalFieldData && originalFieldData.content1) || '';

        return lat != originalLat || long != originalLong;
    }

    /**
     * Check and get field requeriments.
     *
     * @param field Defines the field to be rendered.
     * @param inputData Data entered in the edit form.
     * @return String with the notification or false.
     */
    getFieldsNotifications(field: any, inputData: any): string | false {
        let valueCount = 0;

        // The lat long class has two values that need to be checked.
        inputData.forEach((value) => {
            if (typeof value.value != 'undefined' && value.value != '') {
                valueCount++;
            }
        });

        // If we get here then only one field has been filled in.
        if (valueCount == 1) {
            return this.translate.instant('addon.mod_data.latlongboth');
        } else if (field.required && valueCount == 0) {
            return this.translate.instant('addon.mod_data.errormustsupplyvalue');
        }

        return false;
    }

    /**
     * Override field content data with offline submission.
     *
     * @param originalContent Original data to be overriden.
     * @param offlineContent Array with all the offline data to override.
     * @param offlineFiles Array with all the offline files in the field.
     * @return Data overriden
     */
    overrideData(originalContent: any, offlineContent: any, offlineFiles?: any): any {
        originalContent.content = offlineContent[0] || '';
        originalContent.content1 = offlineContent[1] || '';

        return originalContent;
    }

    /**
     * Whether or not the handler is enabled on a site level.
     *
     * @return True or promise resolved with true if enabled.
     */
    isEnabled(): boolean | Promise<boolean> {
        return true;
    }
}
