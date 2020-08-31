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
// WITHOUT WARRANTIES OR CONDITIONS OFx ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { IonicPage, NavParams, NavController, PopoverController } from 'ionic-angular';
import { CoreAppProvider } from '@providers/app';
import { CoreEventsProvider } from '@providers/events';
import { CoreLocalNotificationsProvider } from '@providers/local-notifications';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreTimeUtilsProvider } from '@providers/utils/time';
import { AddonCalendarProvider, AddonCalendarCalendarEvent } from '../../providers/calendar';
import { AddonCalendarOfflineProvider } from '../../providers/calendar-offline';
import { AddonCalendarHelperProvider, AddonCalendarFilter } from '../../providers/helper';
import { AddonCalendarSyncProvider } from '../../providers/calendar-sync';
import { CoreCoursesProvider } from '@core/courses/providers/courses';
import { CoreCoursesHelperProvider } from '@core/courses/providers/helper';
import { AddonCalendarFilterPopoverComponent } from '../../components/filter/filter';
import { Network } from '@ionic-native/network';
import * as moment from 'moment';

/**
 * Page that displays the calendar events for a certain day.
 */
@IonicPage({ segment: 'addon-calendar-day' })
@Component({
    selector: 'page-addon-calendar-day',
    templateUrl: 'day.html',
})
export class AddonCalendarDayPage implements OnInit, OnDestroy {

    protected currentSiteId: string;
    protected year: number;
    protected month: number;
    protected day: number;
    protected categories = {};
    protected events = []; // Events (both online and offline).
    protected onlineEvents: AddonCalendarCalendarEvent[] = [];
    protected offlineEvents = {}; // Offline events.
    protected offlineEditedEventsIds = []; // IDs of events edited in offline.
    protected deletedEvents = []; // Events deleted in offline.
    protected timeFormat: string;
    protected currentMoment: moment.Moment;
    protected currentTime: number;

    // Observers.
    protected newEventObserver: any;
    protected discardedObserver: any;
    protected editEventObserver: any;
    protected deleteEventObserver: any;
    protected undeleteEventObserver: any;
    protected syncObserver: any;
    protected manualSyncObserver: any;
    protected onlineObserver: any;
    protected obsDefaultTimeChange: any;
    protected filterChangedObserver: any;

    periodName: string;
    filteredEvents = [];
    canCreate = false;
    courses: any[];
    loaded = false;
    hasOffline = false;
    isOnline = false;
    syncIcon: string;
    isCurrentDay: boolean;
    isPastDay: boolean;
    filter: AddonCalendarFilter = {
        filtered: false,
        courseId: null,
        categoryId: null,
        course: true,
        group: true,
        site: true,
        user: true,
        category: true
    };

    constructor(localNotificationsProvider: CoreLocalNotificationsProvider,
            navParams: NavParams,
            network: Network,
            zone: NgZone,
            sitesProvider: CoreSitesProvider,
            private navCtrl: NavController,
            private domUtils: CoreDomUtilsProvider,
            private timeUtils: CoreTimeUtilsProvider,
            private calendarProvider: AddonCalendarProvider,
            private calendarOffline: AddonCalendarOfflineProvider,
            private calendarHelper: AddonCalendarHelperProvider,
            private calendarSync: AddonCalendarSyncProvider,
            private eventsProvider: CoreEventsProvider,
            private coursesProvider: CoreCoursesProvider,
            private coursesHelper: CoreCoursesHelperProvider,
            private appProvider: CoreAppProvider,
            private popoverCtrl: PopoverController) {

        const now = new Date();

        AddonCalendarProvider.ALL_TYPES.forEach((name) => {
            this.filter[name] = navParams.get(name);
            this.filter[name] = typeof this.filter[name] == 'undefined' ? true : this.filter[name];
        });
        this.filter.courseId = navParams.get('courseId');
        this.filter.categoryId = navParams.get('categoryId');

        this.filter.filtered = !!this.filter.courseId || AddonCalendarProvider.ALL_TYPES.some((name) => !this.filter[name]);

        this.year = navParams.get('year') || now.getFullYear();
        this.month = navParams.get('month') || (now.getMonth() + 1);
        this.day = navParams.get('day') || now.getDate();
        this.currentSiteId = sitesProvider.getCurrentSiteId();

        if (localNotificationsProvider.isAvailable()) {
            // Re-schedule events if default time changes.
            this.obsDefaultTimeChange = eventsProvider.on(AddonCalendarProvider.DEFAULT_NOTIFICATION_TIME_CHANGED, () => {
                calendarProvider.scheduleEventsNotifications(this.onlineEvents);
            }, this.currentSiteId);
        }

        // Listen for events added. When an event is added, reload the data.
        this.newEventObserver = eventsProvider.on(AddonCalendarProvider.NEW_EVENT_EVENT, (data) => {
            if (data && data.event) {
                this.loaded = false;
                this.refreshData(true, false, true);
            }
        }, this.currentSiteId);

        // Listen for new event discarded event. When it does, reload the data.
        this.discardedObserver = eventsProvider.on(AddonCalendarProvider.NEW_EVENT_DISCARDED_EVENT, () => {
            this.loaded = false;
            this.refreshData(true, false, true);
        }, this.currentSiteId);

        // Listen for events edited. When an event is edited, reload the data.
        this.editEventObserver = eventsProvider.on(AddonCalendarProvider.EDIT_EVENT_EVENT, (data) => {
            if (data && data.event) {
                this.loaded = false;
                this.refreshData(true, false, true);
            }
        }, this.currentSiteId);

        // Refresh data if calendar events are synchronized automatically.
        this.syncObserver = eventsProvider.on(AddonCalendarSyncProvider.AUTO_SYNCED, (data) => {
            this.loaded = false;
            this.refreshData(false, false, true);
        }, this.currentSiteId);

        // Refresh data if calendar events are synchronized manually but not by this page.
        this.manualSyncObserver = eventsProvider.on(AddonCalendarSyncProvider.MANUAL_SYNCED, (data) => {
            if (data && (data.source != 'day' || data.year != this.year || data.month != this.month || data.day != this.day)) {
                this.loaded = false;
                this.refreshData(false, false, true);
            }
        }, this.currentSiteId);

        // Update the events when an event is deleted.
        this.deleteEventObserver = eventsProvider.on(AddonCalendarProvider.DELETED_EVENT_EVENT, (data) => {
            if (data && !data.sent) {
                // Event was deleted in offline. Just mark it as deleted, no need to refresh.
                this.hasOffline = this.markAsDeleted(data.eventId, true) || this.hasOffline;
                this.deletedEvents.push(data.eventId);
            } else {
                this.loaded = false;
                this.refreshData(false, false, true);
            }
        }, this.currentSiteId);

        // Listen for events "undeleted" (offline).
        this.undeleteEventObserver = eventsProvider.on(AddonCalendarProvider.UNDELETED_EVENT_EVENT, (data) => {
            if (data && data.eventId) {
                // Mark it as undeleted, no need to refresh.
                const found = this.markAsDeleted(data.eventId, false);

                // Remove it from the list of deleted events if it's there.
                const index = this.deletedEvents.indexOf(data.eventId);
                if (index != -1) {
                    this.deletedEvents.splice(index, 1);
                }

                if (found) {
                    // The deleted event belongs to current list. Re-calculate "hasOffline".
                    this.hasOffline = false;

                    if (this.events.length != this.onlineEvents.length) {
                        this.hasOffline = true;
                    } else {
                        const event = this.events.find((event) => {
                            return event.deleted || event.offline;
                        });

                        this.hasOffline = !!event;
                    }
                }
            }
        }, this.currentSiteId);

        this.filterChangedObserver = this.eventsProvider.on(AddonCalendarProvider.FILTER_CHANGED_EVENT, (data) => {
            this.filter = data;

            // Course viewed has changed, check if the user can create events for this course calendar.
            this.calendarHelper.canEditEvents(this.filter['courseId']).then((canEdit) => {
                this.canCreate = canEdit;
            });

            this.filterEvents();
        });

        // Refresh online status when changes.
        this.onlineObserver = network.onchange().subscribe(() => {
            // Execute the callback in the Angular zone, so change detection doesn't stop working.
            zone.run(() => {
                this.isOnline = this.appProvider.isOnline();
            });
        });
    }

    /**
     * View loaded.
     */
    ngOnInit(): void {
        this.calculateCurrentMoment();
        this.calculateIsCurrentDay();

        this.fetchData(true, false);
    }

    /**
     * Fetch all the data required for the view.
     *
     * @param sync Whether it should try to synchronize offline events.
     * @param showErrors Whether to show sync errors to the user.
     * @return Promise resolved when done.
     */
    fetchData(sync?: boolean, showErrors?: boolean): Promise<any> {

        this.syncIcon = 'spinner';
        this.isOnline = this.appProvider.isOnline();

        const promise = sync ? this.sync() : Promise.resolve();

        return promise.then(() => {
            const promises = [];

            // Load courses for the popover.
            promises.push(this.coursesHelper.getCoursesForPopover(this.filter['courseId']).then((data) => {
                this.courses = data.courses;
            }));

            // Get categories.
            promises.push(this.loadCategories());

            // Get offline events.
            promises.push(this.calendarOffline.getAllEditedEvents().then((events) => {
                // Format data.
                events.forEach((event) => {
                    event.offline = true;
                    this.calendarHelper.formatEventData(event);
                });

                // Classify them by month & day.
                this.offlineEvents = this.calendarHelper.classifyIntoMonths(events);

                // // Get the IDs of events edited in offline.
                const filtered = events.filter((event) => {
                    return event.id > 0;
                });
                this.offlineEditedEventsIds = filtered.map((event) => {
                    return event.id;
                });
            }));

            // Get events deleted in offline.
            promises.push(this.calendarOffline.getAllDeletedEventsIds().then((ids) => {
                this.deletedEvents = ids;
            }));

            // Check if user can create events.
            promises.push(this.calendarHelper.canEditEvents(this.filter['courseId']).then((canEdit) => {
                this.canCreate = canEdit;
            }));

            // Get user preferences.
            promises.push(this.calendarProvider.getCalendarTimeFormat().then((value) => {
                this.timeFormat = value;
            }));

            return Promise.all(promises);
        }).then(() => {
            return this.fetchEvents();
        }).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.calendar.errorloadevents', true);
        }).finally(() => {
            this.loaded = true;
            this.syncIcon = 'sync';
        });
    }

    /**
     * Fetch the events for current day.
     *
     * @return Promise resolved when done.
     */
    fetchEvents(): Promise<any> {
        // Don't pass courseId and categoryId, we'll filter them locally.
        return this.calendarProvider.getDayEvents(this.year, this.month, this.day).catch((error) => {
            if (!this.appProvider.isOnline()) {
                // Allow navigating to non-cached days in offline (behave as if using emergency cache).
                return Promise.resolve({ events: <AddonCalendarCalendarEvent[]> [] });
            } else {
                return Promise.reject(error);
            }
        }).then((result) => {
            const promises = [];

            // Calculate the period name. We don't use the one in result because it's in server's language.
            this.periodName = this.timeUtils.userDate(new Date(this.year, this.month - 1, this.day).getTime(),
                    'core.strftimedaydate');

            this.onlineEvents = result.events;
            this.onlineEvents.forEach(this.calendarHelper.formatEventData.bind(this.calendarHelper));

            // Schedule notifications for the events retrieved (only future events will be scheduled).
            this.calendarProvider.scheduleEventsNotifications(this.onlineEvents);

            // Merge the online events with offline data.
            this.events = this.mergeEvents();

            // Filter events by course.
            this.filterEvents();

            this.calculateIsCurrentDay();

            // Re-calculate the formatted time so it uses the device date.
            const dayTime = this.currentMoment.unix() * 1000;
            this.events.forEach((event) => {
                event.ispast = this.isPastDay || (this.isCurrentDay && this.isEventPast(event));
                promises.push(this.calendarProvider.formatEventTime(event, this.timeFormat, true, dayTime).then((time) => {
                    event.formattedtime = time;
                }));
            });

            return Promise.all(promises);
        });
    }

    /**
     * Merge online events with the offline events of that period.
     *
     * @return Merged events.
     */
    protected mergeEvents(): any[] {
        this.hasOffline = false;

        if (!Object.keys(this.offlineEvents).length && !this.deletedEvents.length) {
            // No offline events, nothing to merge.
            return this.onlineEvents;
        }

        const monthOfflineEvents = this.offlineEvents[this.calendarHelper.getMonthId(this.year, this.month)],
            dayOfflineEvents = monthOfflineEvents && monthOfflineEvents[this.day];
        let result = this.onlineEvents;

        if (this.deletedEvents.length) {
            // Mark as deleted the events that were deleted in offline.
            result.forEach((event) => {
                event.deleted = this.deletedEvents.indexOf(event.id) != -1;

                if (event.deleted) {
                    this.hasOffline = true;
                }
            });
        }

        if (this.offlineEditedEventsIds.length) {
            // Remove the online events that were modified in offline.
            result = result.filter((event) => {
                return this.offlineEditedEventsIds.indexOf(event.id) == -1;
            });

            if (result.length != this.onlineEvents.length) {
                this.hasOffline = true;
            }
        }

        if (dayOfflineEvents && dayOfflineEvents.length) {
            // Add the offline events (either new or edited).
            this.hasOffline = true;
            result = this.sortEvents(result.concat(dayOfflineEvents));
        }

        return result;
    }

    /**
     * Filter events based on the filter popover.
     */
    protected filterEvents(): void {
        this.filteredEvents = this.calendarHelper.getFilteredEvents(this.events, this.filter, this.categories);
    }

    /**
     * Sort events by timestart.
     *
     * @param events List to sort.
     */
    protected sortEvents(events: any[]): any[] {
        return events.sort((a, b) => {
            if (a.timestart == b.timestart) {
                return a.timeduration - b.timeduration;
            }

            return a.timestart - b.timestart;
        });
    }

    /**
     * Refresh the data.
     *
     * @param refresher Refresher.
     * @param done Function to call when done.
     * @param showErrors Whether to show sync errors to the user.
     * @return Promise resolved when done.
     */
    doRefresh(refresher?: any, done?: () => void, showErrors?: boolean): Promise<any> {
        if (this.loaded) {
            return this.refreshData(true, showErrors).finally(() => {
                refresher && refresher.complete();
                done && done();
            });
        }

        return Promise.resolve();
    }

    /**
     * Refresh the data.
     *
     * @param sync Whether it should try to synchronize offline events.
     * @param showErrors Whether to show sync errors to the user.
     * @param afterChange Whether the refresh is done after an event has changed or has been synced.
     * @return Promise resolved when done.
     */
    refreshData(sync?: boolean, showErrors?: boolean, afterChange?: boolean): Promise<any> {
        this.syncIcon = 'spinner';

        const promises = [];

        // Don't invalidate day events after a change, it has already been handled.
        if (!afterChange) {
            promises.push(this.calendarProvider.invalidateDayEvents(this.year, this.month, this.day));
        }
        promises.push(this.calendarProvider.invalidateAllowedEventTypes());
        promises.push(this.coursesProvider.invalidateCategories(0, true));
        promises.push(this.calendarProvider.invalidateTimeFormat());

        return Promise.all(promises).finally(() => {
            return this.fetchData(sync, showErrors);
        });
    }

    /**
     * Load categories to be able to filter events.
     *
     * @return Promise resolved when done.
     */
    protected loadCategories(): Promise<any> {
        return this.coursesProvider.getCategories(0, true).then((cats) => {
            this.categories = {};

            // Index categories by ID.
            cats.forEach((category) => {
                this.categories[category.id] = category;
            });
        }).catch(() => {
            // Ignore errors.
        });
    }

    /**
     * Try to synchronize offline events.
     *
     * @param showErrors Whether to show sync errors to the user.
     * @return Promise resolved when done.
     */
    protected sync(showErrors?: boolean): Promise<any> {
        return this.calendarSync.syncEvents().then((result) => {
            if (result.warnings && result.warnings.length) {
                this.domUtils.showErrorModal(result.warnings[0]);
            }

            if (result.updated) {
                // Trigger a manual sync event.
                result.source = 'day';
                result.day = this.day;
                result.month = this.month;
                result.year = this.year;

                this.eventsProvider.trigger(AddonCalendarSyncProvider.MANUAL_SYNCED, result, this.currentSiteId);
            }
        }).catch((error) => {
            if (showErrors) {
                this.domUtils.showErrorModalDefault(error, 'core.errorsync', true);
            }
        });
    }

    /**
     * Navigate to a particular event.
     *
     * @param eventId Event to load.
     */
    gotoEvent(eventId: number): void {
        if (eventId < 0) {
            // It's an offline event, go to the edit page.
            this.openEdit(eventId);
        } else {
            this.navCtrl.push('AddonCalendarEventPage', {
                id: eventId
            });
        }
    }

    /**
     * Show the context menu.
     *
     * @param event Event.
     */
    openFilter(event: MouseEvent): void {
        const popover = this.popoverCtrl.create(AddonCalendarFilterPopoverComponent, {
            courses: this.courses,
            filter: this.filter
        });

        popover.present({
            ev: event
        });
    }

    /**
     * Open page to create/edit an event.
     *
     * @param eventId Event ID to edit.
     */
    openEdit(eventId?: number): void {
        const params: any = {};

        if (eventId) {
            params.eventId = eventId;
        } else {
            // It's a new event, set the time.
            params.timestamp = moment().year(this.year).month(this.month - 1).date(this.day).unix() * 1000;
        }

        if (this.filter['courseId']) {
            params.courseId = this.filter['courseId'];
        }

        this.navCtrl.push('AddonCalendarEditEventPage', params);
    }

    /**
     * Calculate current moment.
     */
    calculateCurrentMoment(): void {
        this.currentMoment = moment().year(this.year).month(this.month - 1).date(this.day);
    }

    /**
     * Check if user is viewing the current day.
     */
    calculateIsCurrentDay(): void {
        const now = new Date();

        this.currentTime = this.timeUtils.timestamp();

        this.isCurrentDay = this.year == now.getFullYear() && this.month == now.getMonth() + 1 && this.day == now.getDate();
        this.isPastDay = this.year < now.getFullYear() || (this.year == now.getFullYear() && this.month < now.getMonth()) ||
            (this.year == now.getFullYear() && this.month == now.getMonth() + 1 && this.day < now.getDate());
    }

    /**
     * Go to current day.
     */
    goToCurrentDay(): void {
        const now = new Date(),
            initialDay = this.day,
            initialMonth = this.month,
            initialYear = this.year;

        this.day = now.getDate();
        this.month = now.getMonth() + 1;
        this.year = now.getFullYear();
        this.calculateCurrentMoment();

        this.loaded = false;

        this.fetchEvents().then(() => {
            this.isCurrentDay = true;
        }).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.calendar.errorloadevents', true);

            this.year = initialYear;
            this.month = initialMonth;
            this.day = initialDay;
            this.calculateCurrentMoment();
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Load next month.
     */
    loadNext(): void {
        this.increaseDay();

        this.loaded = false;

        this.fetchEvents().catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.calendar.errorloadevents', true);
            this.decreaseDay();
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Load previous month.
     */
    loadPrevious(): void {
        this.decreaseDay();

        this.loaded = false;

        this.fetchEvents().catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.calendar.errorloadevents', true);
            this.increaseDay();
        }).finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Decrease the current day.
     */
    protected decreaseDay(): void {
        this.currentMoment.subtract(1, 'day');

        this.year = this.currentMoment.year();
        this.month = this.currentMoment.month() + 1;
        this.day = this.currentMoment.date();
    }

    /**
     * Increase the current day.
     */
    protected increaseDay(): void {
        this.currentMoment.add(1, 'day');

        this.year = this.currentMoment.year();
        this.month = this.currentMoment.month() + 1;
        this.day = this.currentMoment.date();
    }

    /**
     * Find an event and mark it as deleted.
     *
     * @param eventId Event ID.
     * @param deleted Whether to mark it as deleted or not.
     * @return Whether the event was found.
     */
    protected markAsDeleted(eventId: number, deleted: boolean): boolean {
        const event = this.onlineEvents.find((event) => {
            return event.id == eventId;
        });

        if (event) {
            event.deleted = deleted;

            return true;
        }

        return false;
    }

    /**
     * Returns if the event is in the past or not.
     * @param event Event object.
     * @return True if it's in the past.
     */
    isEventPast(event: any): boolean {
        return (event.timestart + event.timeduration) < this.currentTime;
    }

    /**
     * Page destroyed.
     */
    ngOnDestroy(): void {
        this.newEventObserver && this.newEventObserver.off();
        this.discardedObserver && this.discardedObserver.off();
        this.editEventObserver && this.editEventObserver.off();
        this.deleteEventObserver && this.deleteEventObserver.off();
        this.undeleteEventObserver && this.undeleteEventObserver.off();
        this.syncObserver && this.syncObserver.off();
        this.manualSyncObserver && this.manualSyncObserver.off();
        this.onlineObserver && this.onlineObserver.unsubscribe();
        this.filterChangedObserver && this.filterChangedObserver.off();
        this.obsDefaultTimeChange && this.obsDefaultTimeChange.off();
    }
}
