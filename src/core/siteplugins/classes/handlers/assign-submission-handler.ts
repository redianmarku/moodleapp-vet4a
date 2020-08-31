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
import { TranslateService } from '@ngx-translate/core';
import { AddonModAssignBaseSubmissionHandler } from '@addon/mod/assign/classes/base-submission-handler';
import { CoreSitePluginsAssignSubmissionComponent } from '../../components/assign-submission/assign-submission';

/**
 * Handler to display an assign submission site plugin.
 */
export class CoreSitePluginsAssignSubmissionHandler extends AddonModAssignBaseSubmissionHandler {

    constructor(translate: TranslateService, public name: string, public type: string, protected prefix: string) {
        super(translate);
    }

    /**
     * Return the Component to use to display the plugin data, either in read or in edit mode.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     *
     * @param injector Injector.
     * @param plugin The plugin object.
     * @param edit Whether the user is editing.
     * @return The component (or promise resolved with component) to use, undefined if not found.
     */
    getComponent(injector: Injector, plugin: any, edit?: boolean): any | Promise<any> {
        return CoreSitePluginsAssignSubmissionComponent;
    }

    /**
     * Get a readable name to use for the plugin.
     *
     * @param plugin The plugin object.
     * @return The plugin name.
     */
    getPluginName(plugin: any): string {
        // Check if there's a translated string for the plugin.
        const translationId = this.prefix + 'pluginname',
            translation = this.translate.instant(translationId);

        if (translationId != translation) {
            // Translation found, use it.
            return translation;
        }

        // Fallback to WS string.
        if (plugin.name) {
            return plugin.name;
        }
    }

    /**
     * Whether or not the handler is enabled for edit on a site level.
     *
     * @return Whether or not the handler is enabled for edit on a site level.
     */
    isEnabledForEdit(): boolean | Promise<boolean> {
        return true;
    }
}
