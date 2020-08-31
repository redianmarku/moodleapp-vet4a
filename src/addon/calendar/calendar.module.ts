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
import { AddonCalendarProvider } from './providers/calendar';
import { AddonCalendarOfflineProvider } from './providers/calendar-offline';
import { AddonCalendarHelperProvider } from './providers/helper';
import { AddonCalendarSyncProvider } from './providers/calendar-sync';
import { AddonCalendarMainMenuHandler } from './providers/mainmenu-handler';
import { AddonCalendarSyncCronHandler } from './providers/sync-cron-handler';
import { AddonCalendarViewLinkHandler } from './providers/view-link-handler';
import { CoreMainMenuDelegate } from '@core/mainmenu/providers/delegate';
import { CoreCronDelegate } from '@providers/cron';
import { CoreInitDelegate } from '@providers/init';
import { CoreLocalNotificationsProvider } from '@providers/local-notifications';
import { CoreLoginHelperProvider } from '@core/login/providers/helper';
import { CoreContentLinksDelegate } from '@core/contentlinks/providers/delegate';
import { AddonCalendarComponentsModule } from './components/components.module';

// List of providers (without handlers).
export const ADDON_CALENDAR_PROVIDERS: any[] = [
    AddonCalendarProvider,
    AddonCalendarOfflineProvider,
    AddonCalendarHelperProvider,
    AddonCalendarSyncProvider
];

@NgModule({
    declarations: [
    ],
    imports: [
        AddonCalendarComponentsModule,
    ],
    providers: [
        AddonCalendarProvider,
        AddonCalendarOfflineProvider,
        AddonCalendarHelperProvider,
        AddonCalendarSyncProvider,
        AddonCalendarMainMenuHandler,
        AddonCalendarSyncCronHandler,
        AddonCalendarViewLinkHandler
    ]
})
export class AddonCalendarModule {
    constructor(mainMenuDelegate: CoreMainMenuDelegate, calendarHandler: AddonCalendarMainMenuHandler,
            initDelegate: CoreInitDelegate, calendarProvider: AddonCalendarProvider, loginHelper: CoreLoginHelperProvider,
            localNotificationsProvider: CoreLocalNotificationsProvider,
            cronDelegate: CoreCronDelegate, syncHandler: AddonCalendarSyncCronHandler,
            contentLinksDelegate: CoreContentLinksDelegate, viewLinkHandler: AddonCalendarViewLinkHandler) {

        mainMenuDelegate.registerHandler(calendarHandler);
        cronDelegate.register(syncHandler);
        contentLinksDelegate.registerHandler(viewLinkHandler);

        initDelegate.ready().then(() => {
            calendarProvider.scheduleAllSitesEventsNotifications();
        });

        localNotificationsProvider.registerClick(AddonCalendarProvider.COMPONENT, (data) => {
            if (data.eventid) {
                initDelegate.ready().then(() => {
                    calendarProvider.isDisabled(data.siteId).then((disabled) => {
                        if (disabled) {
                            // The calendar is disabled in the site, don't open it.
                            return;
                        }

                        // Check which page we should load.
                        calendarProvider.canViewMonth(data.siteId).then((canView) => {
                            const pageName = canView ? 'AddonCalendarIndexPage' : 'AddonCalendarListPage';

                            loginHelper.redirect(pageName, {eventId: data.eventid}, data.siteId);
                        });

                    });
                });
            }
        });
    }
}
