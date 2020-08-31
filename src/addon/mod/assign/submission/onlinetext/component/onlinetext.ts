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

import { Component, OnInit, ElementRef } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreTextUtilsProvider } from '@providers/utils/text';
import { AddonModAssignProvider } from '../../../providers/assign';
import { AddonModAssignOfflineProvider } from '../../../providers/assign-offline';
import { AddonModAssignSubmissionPluginComponent } from '../../../classes/submission-plugin-component';

/**
 * Component to render an onlinetext submission plugin.
 */
@Component({
    selector: 'addon-mod-assign-submission-online-text',
    templateUrl: 'addon-mod-assign-submission-onlinetext.html'
})
export class AddonModAssignSubmissionOnlineTextComponent extends AddonModAssignSubmissionPluginComponent implements OnInit {

    control: FormControl;
    words: number;
    component = AddonModAssignProvider.COMPONENT;
    text: string;
    loaded: boolean;
    wordLimitEnabled: boolean;
    currentUserId: number;

    protected wordCountTimeout: any;
    protected element: HTMLElement;

    constructor(
            protected fb: FormBuilder,
            protected domUtils: CoreDomUtilsProvider,
            protected textUtils: CoreTextUtilsProvider,
            protected assignProvider: AddonModAssignProvider,
            protected assignOfflineProvider: AddonModAssignOfflineProvider,
            element: ElementRef,
            sitesProvider: CoreSitesProvider) {

        super();
        this.element = element.nativeElement;
        this.currentUserId = sitesProvider.getCurrentSiteUserId();
    }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        // Get the text. Check if we have anything offline.
        this.assignOfflineProvider.getSubmission(this.assign.id).catch(() => {
            // No offline data found.
        }).then((offlineData) => {
            if (offlineData && offlineData.plugindata && offlineData.plugindata.onlinetext_editor) {
                return offlineData.plugindata.onlinetext_editor.text;
            }

            // No offline data found, return online text.
            return this.assignProvider.getSubmissionPluginText(this.plugin);
        }).then((text) => {
            this.wordLimitEnabled = !!parseInt(this.configs.wordlimitenabled, 10);

            // Set the text.
            this.text = text;

            if (!this.edit) {
                // Not editing, see full text when clicked.
                this.element.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (text) {
                        // Open a new state with the interpolated contents.
                        this.textUtils.viewText(this.plugin.name, text, {
                            component: this.component,
                            componentId: this.assign.cmid,
                            filter: true,
                            contextLevel: 'module',
                            instanceId: this.assign.cmid,
                            courseId: this.assign.course,
                        });
                    }
                });
            } else {
                // Create and add the control.
                this.control = this.fb.control(text);
            }

            // Calculate initial words.
            if (this.wordLimitEnabled) {
                this.words = this.textUtils.countWords(text);
            }
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Text changed.
     *
     * @param text The new text.
     */
    onChange(text: string): void {
        // Count words if needed.
        if (this.wordLimitEnabled) {
            // Cancel previous wait.
            clearTimeout(this.wordCountTimeout);

            // Wait before calculating, if the user keeps inputing we won't calculate.
            // This is to prevent slowing down devices, this calculation can be slow if the text is long.
            this.wordCountTimeout = setTimeout(() => {
                this.words = this.textUtils.countWords(text);
            }, 1500);
        }
    }
}
