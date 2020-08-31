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

import { Component, Optional, Injector } from '@angular/core';
import { Content } from 'ionic-angular';
import { CoreCourseModuleMainActivityComponent } from '@core/course/classes/main-activity-component';
import { AddonModLtiProvider, AddonModLtiLti } from '../../providers/lti';
import { AddonModLtiHelper } from '../../providers/helper';

/**
 * Component that displays an LTI entry page.
 */
@Component({
    selector: 'addon-mod-lti-index',
    templateUrl: 'addon-mod-lti-index.html',
})
export class AddonModLtiIndexComponent extends CoreCourseModuleMainActivityComponent {
    component = AddonModLtiProvider.COMPONENT;
    moduleName = 'lti';

    lti: AddonModLtiLti; // The LTI object.

    protected fetchContentDefaultError = 'addon.mod_lti.errorgetlti';

    constructor(injector: Injector,
            @Optional() protected content: Content,
            private ltiProvider: AddonModLtiProvider) {
        super(injector, content);
    }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        super.ngOnInit();

        this.loadContent();
    }

    /**
     * Check the completion.
     */
    protected checkCompletion(): void {
        this.courseProvider.checkModuleCompletion(this.courseId, this.module.completiondata);
    }

    /**
     * Get the LTI data.
     *
     * @param refresh If it's refreshing content.
     * @param sync If it should try to sync.
     * @param showErrors If show errors to the user of hide them.
     * @return Promise resolved when done.
     */
    protected fetchContent(refresh: boolean = false, sync: boolean = false, showErrors: boolean = false): Promise<any> {
        return this.ltiProvider.getLti(this.courseId, this.module.id).then((ltiData) => {
            this.lti = ltiData;
            this.description = this.lti.intro;
            this.dataRetrieved.emit(this.lti);
        }).finally(() => {
            this.fillContextMenu(refresh);
        });
    }

    /**
     * Perform the invalidate content function.
     *
     * @return Resolved when done.
     */
    protected invalidateContent(): Promise<any> {
        const promises = [];

        promises.push(this.ltiProvider.invalidateLti(this.courseId));
        if (this.lti) {
            promises.push(this.ltiProvider.invalidateLtiLaunchData(this.lti.id));
        }

        return Promise.all(promises);
    }

    /**
     * Launch the LTI.
     */
    launch(): void {
        AddonModLtiHelper.instance.getDataAndLaunch(this.courseId, this.module, this.lti);
    }
}
