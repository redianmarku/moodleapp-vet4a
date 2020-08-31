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
import { AddonCourseCompletionProvider } from './providers/coursecompletion';
import { AddonCourseCompletionCourseOptionHandler } from './providers/course-option-handler';
import { AddonCourseCompletionUserHandler } from './providers/user-handler';
import { AddonCourseCompletionComponentsModule } from './components/components.module';
import { CoreCourseOptionsDelegate } from '@core/course/providers/options-delegate';
import { CoreUserDelegate } from '@core/user/providers/user-delegate';

@NgModule({
    declarations: [
    ],
    imports: [
        AddonCourseCompletionComponentsModule
    ],
    providers: [
        AddonCourseCompletionProvider,
        AddonCourseCompletionCourseOptionHandler,
        AddonCourseCompletionUserHandler
    ]
})
export class AddonCourseCompletionModule {
    constructor(courseOptionsDelegate: CoreCourseOptionsDelegate, courseOptionHandler: AddonCourseCompletionCourseOptionHandler,
            userDelegate: CoreUserDelegate, userHandler: AddonCourseCompletionUserHandler) {
        // Register handlers.
        courseOptionsDelegate.registerHandler(courseOptionHandler);
        userDelegate.registerHandler(userHandler);
    }
}
