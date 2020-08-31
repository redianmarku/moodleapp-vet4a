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

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from 'ionic-angular';
import { TranslateModule } from '@ngx-translate/core';
import { AddonModAssignSubmissionCommentsHandler } from './providers/handler';
import { AddonModAssignSubmissionCommentsComponent } from './component/comments';
import { AddonModAssignSubmissionDelegate } from '../../providers/submission-delegate';
import { CoreCommentsComponentsModule } from '@core/comments/components/components.module';

@NgModule({
    declarations: [
        AddonModAssignSubmissionCommentsComponent
    ],
    imports: [
        CommonModule,
        IonicModule,
        TranslateModule.forChild(),
        CoreCommentsComponentsModule
    ],
    providers: [
        AddonModAssignSubmissionCommentsHandler
    ],
    exports: [
        AddonModAssignSubmissionCommentsComponent
    ],
    entryComponents: [
        AddonModAssignSubmissionCommentsComponent
    ]
})
export class AddonModAssignSubmissionCommentsModule {
    constructor(submissionDelegate: AddonModAssignSubmissionDelegate, handler: AddonModAssignSubmissionCommentsHandler) {
        submissionDelegate.registerHandler(handler);
    }
}
