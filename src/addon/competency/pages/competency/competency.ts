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

import { Component, Optional } from '@angular/core';
import { IonicPage, NavController, NavParams } from 'ionic-angular';
import { TranslateService } from '@ngx-translate/core';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreSplitViewComponent } from '@components/split-view/split-view';
import {
    AddonCompetencyProvider, AddonCompetencyUserCompetencySummary, AddonCompetencyUserCompetencySummaryInPlan,
    AddonCompetencyUserCompetencySummaryInCourse, AddonCompetencyUserCompetencyPlan,
    AddonCompetencyUserCompetency, AddonCompetencyUserCompetencyCourse
} from '../../providers/competency';
import { AddonCompetencyHelperProvider } from '../../providers/helper';
import { CoreUserSummary } from '@core/user/providers/user';
import { CoreCourseModuleSummary } from '@core/course/providers/course';

/**
 * Page that displays a learning plan.
 */
@IonicPage({ segment: 'addon-competency-competency' })
@Component({
    selector: 'page-addon-competency-competency',
    templateUrl: 'competency.html',
})
export class AddonCompetencyCompetencyPage {
    competencyLoaded = false;
    competencyId: number;
    planId: number;
    courseId: number;
    userId: number;
    planStatus: number;
    coursemodules: CoreCourseModuleSummary[];
    user: CoreUserSummary;
    competency: AddonCompetencyUserCompetencySummary;
    userCompetency: AddonCompetencyUserCompetencyPlan | AddonCompetencyUserCompetency | AddonCompetencyUserCompetencyCourse;
    contextLevel: string;
    contextInstanceId: number;

    constructor(private navCtrl: NavController, navParams: NavParams, private translate: TranslateService,
            private sitesProvider: CoreSitesProvider, private domUtils: CoreDomUtilsProvider,
            @Optional() private svComponent: CoreSplitViewComponent, private competencyProvider: AddonCompetencyProvider,
            private competencyHelperProvider: AddonCompetencyHelperProvider) {
        this.competencyId = navParams.get('competencyId');
        this.planId = navParams.get('planId');
        this.courseId = navParams.get('courseId');
        this.userId = navParams.get('userId');
    }

    /**
     * View loaded.
     */
    ionViewDidLoad(): void {
        this.fetchCompetency().then(() => {
            const name = this.competency && this.competency.competency && this.competency.competency.competency &&
                    this.competency.competency.competency.shortname;

            if (this.planId) {
                this.competencyProvider.logCompetencyInPlanView(this.planId, this.competencyId, this.planStatus, name,
                        this.userId).catch(() => {
                    // Ignore errors.
                });
            } else {
                this.competencyProvider.logCompetencyInCourseView(this.courseId, this.competencyId, name, this.userId).catch(() => {
                    // Ignore errors.
                });
            }
        }).finally(() => {
            this.competencyLoaded = true;
        });
    }

    /**
     * Fetches the competency and updates the view.
     *
     * @return Promise resolved when done.
     */
    protected fetchCompetency(): Promise<void> {
        let promise: Promise<AddonCompetencyUserCompetencySummaryInPlan | AddonCompetencyUserCompetencySummaryInCourse>;

        if (this.planId) {
            this.planStatus = null;
            promise = this.competencyProvider.getCompetencyInPlan(this.planId, this.competencyId);
        } else if (this.courseId) {
            promise = this.competencyProvider.getCompetencyInCourse(this.courseId, this.competencyId, this.userId);
        } else {
            promise = Promise.reject(null);
        }

        return promise.then((competency) => {

            // Calculate the context.
            if (this.courseId) {
                this.contextLevel = 'course';
                this.contextInstanceId = this.courseId;
            } else {
                this.contextLevel = 'user';
                this.contextInstanceId = this.userId || competency.usercompetencysummary.user.id;
            }

            this.competency = competency.usercompetencysummary;
            this.userCompetency = this.competency.usercompetencyplan || this.competency.usercompetency;

            if (this.planId) {
                this.planStatus = (<AddonCompetencyUserCompetencySummaryInPlan> competency).plan.status;
                this.competency.usercompetency.statusname =
                    this.competencyHelperProvider.getCompetencyStatusName(this.competency.usercompetency.status);
            } else {
                this.userCompetency = this.competency.usercompetencycourse;
                this.coursemodules = (<AddonCompetencyUserCompetencySummaryInCourse> competency).coursemodules;
            }

            if (this.competency.user.id != this.sitesProvider.getCurrentSiteUserId()) {
                // Get the user profile from the returned object.
                this.user = this.competency.user;
            }

            this.competency.evidence.forEach((evidence) => {
                if (evidence.descidentifier) {
                    const key = 'addon.competency.' + evidence.descidentifier;
                    evidence.description = this.translate.instant(key, {$a: evidence.desca});
                }
            });
        }).catch((message) => {
            this.domUtils.showErrorModalDefault(message, 'Error getting competency data.');
        });
    }

    /**
     * Refreshes the competency.
     *
     * @param refresher Refresher.
     */
    refreshCompetency(refresher: any): void {
        let promise;
        if (this.planId) {
            promise = this.competencyProvider.invalidateCompetencyInPlan(this.planId, this.competencyId);
        } else {
            promise = this.competencyProvider.invalidateCompetencyInCourse(this.courseId, this.competencyId);
        }

        return promise.finally(() => {
            this.fetchCompetency().finally(() => {
                refresher.complete();
            });
        });
    }

    /**
     * Opens the summary of a competency.
     *
     * @param competencyId
     */
    openCompetencySummary(competencyId: number): void {
        // Decide which navCtrl to use. If this page is inside a split view, use the split view's master nav.
        const navCtrl = this.svComponent ? this.svComponent.getMasterNav() : this.navCtrl;
        navCtrl.push('AddonCompetencyCompetencySummaryPage', {
            competencyId,
            contextLevel: this.contextLevel,
            contextInstanceId: this.contextInstanceId
        });
    }
}
