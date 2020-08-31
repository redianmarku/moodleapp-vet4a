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

import { Injectable, Injector } from '@angular/core';
import { CoreDelegate, CoreDelegateHandler } from '@classes/delegate';
import { CoreEventsProvider } from '@providers/events';
import { CoreLoggerProvider } from '@providers/logger';
import { CoreSitesProvider } from '@providers/sites';
import { CoreUtilsProvider, PromiseDefer } from '@providers/utils/utils';
import { CoreCoursesProvider } from '@core/courses/providers/courses';
import { CoreCourseProvider } from './course';

/**
 * Interface that all course options handlers must implement.
 */
export interface CoreCourseOptionsHandler extends CoreDelegateHandler {
    /**
     * The highest priority is displayed first.
     */
    priority: number;

    /**
     * True if this handler should appear in menu rather than as a tab.
     */
    isMenuHandler?: boolean;

    /**
     * Whether or not the handler is enabled for a certain course.
     *
     * @param courseId The course ID.
     * @param accessData Access type and data. Default, guest, ...
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return True or promise resolved with true if enabled.
     */
    isEnabledForCourse(courseId: number, accessData: any, navOptions?: any, admOptions?: any): boolean | Promise<boolean>;

    /**
     * Returns the data needed to render the handler.
     *
     * @param injector Injector.
     * @param course The course.
     * @return Data or promise resolved with the data.
     */
    getDisplayData?(injector: Injector, course: any): CoreCourseOptionsHandlerData | Promise<CoreCourseOptionsHandlerData>;

    /**
     * Should invalidate the data to determine if the handler is enabled for a certain course.
     *
     * @param courseId The course ID.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved when done.
     */
    invalidateEnabledForCourse?(courseId: number, navOptions?: any, admOptions?: any): Promise<any>;

    /**
     * Called when a course is downloaded. It should prefetch all the data to be able to see the addon in offline.
     *
     * @param course The course.
     * @return Promise resolved when done.
     */
    prefetch?(course: any): Promise<any>;
}

/**
 * Interface that course options handlers implement if they appear in the menu rather than as a tab.
 */
export interface CoreCourseOptionsMenuHandler extends CoreCourseOptionsHandler {
    /**
     * Returns the data needed to render the handler.
     *
     * @param injector Injector.
     * @param course The course.
     * @return Data or promise resolved with data.
     */
    getMenuDisplayData(injector: Injector, course: any):
        CoreCourseOptionsMenuHandlerData | Promise<CoreCourseOptionsMenuHandlerData>;
}

/**
 * Data needed to render a course handler. It's returned by the handler.
 */
export interface CoreCourseOptionsHandlerData {
    /**
     * Title to display for the handler.
     */
    title: string;

    /**
     * Class to add to the displayed handler.
     */
    class?: string;

    /**
     * The component to render the handler. It must be the component class, not the name or an instance.
     * When the component is created, it will receive the courseId as input.
     */
    component: any;

    /**
     * Data to pass to the component. All the properties in this object will be passed to the component as inputs.
     */
    componentData?: any;
}

/**
 * Data needed to render a course menu handler. It's returned by the handler.
 */
export interface CoreCourseOptionsMenuHandlerData {
    /**
     * Title to display for the handler.
     */
    title: string;

    /**
     * Class to add to the displayed handler.
     */
    class?: string;

    /**
     * Name of the page to load for the handler.
     */
    page: string;

    /**
     * Params to pass to the page (other than 'course' which is always sent).
     */
    pageParams?: any;

    /**
     * Name of the icon to display for the handler.
     */
    icon: string; // Name of the icon to display in the tab.
}

/**
 * Data returned by the delegate for each handler.
 */
export interface CoreCourseOptionsHandlerToDisplay {
    /**
     * Data to display.
     */
    data: CoreCourseOptionsHandlerData;

    /**
     * Name of the handler, or name and sub context (AddonMessages, AddonMessages:blockContact, ...).
     */
    name: string;

    /**
     * The highest priority is displayed first.
     */
    priority?: number;

    /**
     * Called when a course is downloaded. It should prefetch all the data to be able to see the addon in offline.
     *
     * @param course The course.
     * @return Promise resolved when done.
     */
    prefetch?(course: any): Promise<any>;
}

/**
 * Additional data returned if it is a menu item.
 */
export interface CoreCourseOptionsMenuHandlerToDisplay {
    /**
     * Data to display.
     */
    data: CoreCourseOptionsMenuHandlerData;

    /**
     * Name of the handler, or name and sub context (AddonMessages, AddonMessages:blockContact, ...).
     */
    name: string;

    /**
     * The highest priority is displayed first.
     */
    priority?: number;

    /**
     * Called when a course is downloaded. It should prefetch all the data to be able to see the addon in offline.
     *
     * @param course The course.
     * @return Promise resolved when done.
     */
    prefetch?(course: any): Promise<any>;
}

/**
 * Service to interact with plugins to be shown in each course (participants, learning plans, ...).
 */
@Injectable()
export class CoreCourseOptionsDelegate extends CoreDelegate {
    protected loaded: { [courseId: number]: boolean } = {};
    protected lastUpdateHandlersForCoursesStart: any = {};
    protected coursesHandlers: {
        [courseId: number]: {
            access?: any, navOptions?: any, admOptions?: any, deferred?: PromiseDefer,
            enabledHandlers?: CoreCourseOptionsHandler[], enabledMenuHandlers?: CoreCourseOptionsMenuHandler[]
        }
    } = {};

    protected featurePrefix = 'CoreCourseOptionsDelegate_';

    constructor(loggerProvider: CoreLoggerProvider, protected sitesProvider: CoreSitesProvider, private utils: CoreUtilsProvider,
            protected eventsProvider: CoreEventsProvider, private coursesProvider: CoreCoursesProvider) {
        super('CoreCourseOptionsDelegate', loggerProvider, sitesProvider, eventsProvider);

        eventsProvider.on(CoreEventsProvider.LOGOUT, () => {
            this.clearCoursesHandlers();
        });
    }

    /**
     * Check if handlers are loaded for a certain course.
     *
     * @param courseId The course ID to check.
     * @return True if handlers are loaded, false otherwise.
     */
    areHandlersLoaded(courseId: number): boolean {
        return !!this.loaded[courseId];
    }

    /**
     * Clear all course options handlers.
     *
     * @param courseId The course ID. If not defined, all handlers will be cleared.
     */
    protected clearCoursesHandlers(courseId?: number): void {
        if (courseId) {
            if (!this.loaded[courseId]) {
                // Don't clear if not loaded, it's probably an ongoing load and it could cause JS errors.
                return;
            }

            this.loaded[courseId] = false;
            delete this.coursesHandlers[courseId];
        } else {
            for (const courseId in this.coursesHandlers) {
                this.clearCoursesHandlers(Number(courseId));
            }
        }
    }

    /**
     * Clear all courses handlers and invalidate its options.
     *
     * @param courseId The course ID. If not defined, all handlers will be cleared.
     * @return Promise resolved when done.
     */
    clearAndInvalidateCoursesOptions(courseId?: number): Promise<any> {
        const promises = [];

        this.eventsProvider.trigger(CoreCoursesProvider.EVENT_MY_COURSES_REFRESHED);

        // Invalidate course enabled data for the handlers that are enabled at site level.
        if (courseId) {
            // Invalidate only options for this course.
            promises.push(this.coursesProvider.invalidateCoursesAdminAndNavOptions([courseId]));
            promises.push(this.invalidateCourseHandlers(courseId));
        } else {
            // Invalidate all options.
            promises.push(this.coursesProvider.invalidateUserNavigationOptions());
            promises.push(this.coursesProvider.invalidateUserAdministrationOptions());

            for (const cId in this.coursesHandlers) {
                promises.push(this.invalidateCourseHandlers(parseInt(cId, 10)));
            }
        }

        this.clearCoursesHandlers(courseId);

        return Promise.all(promises);
    }

    /**
     * Get the handlers for a course using a certain access type.
     *
     * @param courseId The course ID.
     * @param refresh True if it should refresh the list.
     * @param accessData Access type and data. Default, guest, ...
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with array of handlers.
     */
    protected getHandlersForAccess(courseId: number, refresh: boolean, accessData: any, navOptions?: any,
            admOptions?: any): Promise<CoreCourseOptionsHandler[]> {

        // If the handlers aren't loaded, do not refresh.
        if (!this.loaded[courseId]) {
            refresh = false;
        }

        if (refresh || !this.coursesHandlers[courseId] || this.coursesHandlers[courseId].access.type != accessData.type) {
            if (!this.coursesHandlers[courseId]) {
                this.coursesHandlers[courseId] = {};
            }
            this.coursesHandlers[courseId].access = accessData;
            this.coursesHandlers[courseId].navOptions = navOptions;
            this.coursesHandlers[courseId].admOptions = admOptions;
            this.coursesHandlers[courseId].deferred = this.utils.promiseDefer();
            this.updateHandlersForCourse(courseId, accessData, navOptions, admOptions);
        }

        return this.coursesHandlers[courseId].deferred.promise.then(() => {
            return this.coursesHandlers[courseId].enabledHandlers;
        });
    }

    /**
     * Get the list of handlers that should be displayed for a course.
     * This function should be called only when the handlers need to be displayed, since it can call several WebServices.
     *
     * @param injector Injector.
     * @param course The course object.
     * @param refresh True if it should refresh the list.
     * @param isGuest Whether it's guest.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with array of handlers.
     */
    getHandlersToDisplay(injector: Injector, course: any, refresh?: boolean, isGuest?: boolean, navOptions?: any, admOptions?: any):
            Promise<CoreCourseOptionsHandlerToDisplay[]> {
        return <Promise<CoreCourseOptionsHandlerToDisplay[]>> this.getHandlersToDisplayInternal(
                false, injector, course, refresh, isGuest, navOptions, admOptions);
    }

    /**
     * Get the list of menu handlers that should be displayed for a course.
     * This function should be called only when the handlers need to be displayed, since it can call several WebServices.
     *
     * @param injector Injector.
     * @param course The course object.
     * @param refresh True if it should refresh the list.
     * @param isGuest Whether it's guest.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with array of handlers.
     */
    getMenuHandlersToDisplay(injector: Injector, course: any, refresh?: boolean, isGuest?: boolean,
            navOptions?: any, admOptions?: any): Promise<CoreCourseOptionsMenuHandlerToDisplay[]> {
        return <Promise<CoreCourseOptionsMenuHandlerToDisplay[]>> this.getHandlersToDisplayInternal(
                true, injector, course, refresh, isGuest, navOptions, admOptions);
    }

    /**
     * Get the list of menu handlers that should be displayed for a course.
     * This function should be called only when the handlers need to be displayed, since it can call several WebServices.
     *
     * @param menu If true, gets menu handlers; false, gets tab handlers
     * @param injector Injector.
     * @param course The course object.
     * @param refresh True if it should refresh the list.
     * @param isGuest Whether it's guest.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with array of handlers.
     */
    protected getHandlersToDisplayInternal(menu: boolean, injector: Injector, course: any, refresh: boolean, isGuest: boolean,
            navOptions: any, admOptions: any): Promise<any[]> {
        course.id = parseInt(course.id, 10);

        const accessData = {
                type: isGuest ? CoreCourseProvider.ACCESS_GUEST : CoreCourseProvider.ACCESS_DEFAULT
            },
            handlersToDisplay: CoreCourseOptionsHandlerToDisplay[] = [];

        if (navOptions) {
            course.navOptions = navOptions;
        }
        if (admOptions) {
            course.admOptions = admOptions;
        }

        return this.loadCourseOptions(course, refresh).then(() => {
            // Call getHandlersForAccess to make sure the handlers have been loaded.
            return this.getHandlersForAccess(course.id, refresh, accessData, course.navOptions, course.admOptions);
        }).then(() => {
            const promises = [];

            let handlerList;
            if (menu) {
                handlerList = this.coursesHandlers[course.id].enabledMenuHandlers;
            } else {
                handlerList = this.coursesHandlers[course.id].enabledHandlers;
            }

            handlerList.forEach((handler) => {
                const getFunction = menu ? handler.getMenuDisplayData : handler.getDisplayData;
                promises.push(Promise.resolve(getFunction.call(handler, injector, course)).then((data) => {
                    handlersToDisplay.push({
                        data: data,
                        priority: handler.priority,
                        prefetch: handler.prefetch && handler.prefetch.bind(handler),
                        name: handler.name
                    });
                }).catch((err) => {
                    this.logger.error('Error getting data for handler', handler.name, err);
                }));
            });

            return Promise.all(promises);
        }).then(() => {

            // Sort them by priority.
            handlersToDisplay.sort((a, b) => {
                return b.priority - a.priority;
            });

            return handlersToDisplay;
        });
    }

    /**
     * Check if a course has any handler enabled for default access, using course object.
     *
     * @param course The course object.
     * @param refresh True if it should refresh the list.
     * @return Promise resolved with boolean: true if it has handlers, false otherwise.
     */
    hasHandlersForCourse(course: any, refresh?: boolean): Promise<boolean> {
        // Load course options if missing.
        return this.loadCourseOptions(course, refresh).then(() => {
            return this.hasHandlersForDefault(course.id, refresh, course.navOptions, course.admOptions);
        });
    }

    /**
     * Check if a course has any handler enabled for default access.
     *
     * @param courseId The course ID.
     * @param refresh True if it should refresh the list.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with boolean: true if it has handlers, false otherwise.
     */
    hasHandlersForDefault(courseId: number, refresh?: boolean, navOptions?: any, admOptions?: any): Promise<boolean> {
        // Default access.
        const accessData = {
            type: CoreCourseProvider.ACCESS_DEFAULT
        };

        return this.getHandlersForAccess(courseId, refresh, accessData, navOptions, admOptions).then((handlers) => {
            return !!(handlers && handlers.length);
        });
    }

    /**
     * Check if a course has any handler enabled for guest access.
     *
     * @param courseId The course ID.
     * @param refresh True if it should refresh the list.
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Promise resolved with boolean: true if it has handlers, false otherwise.
     */
    hasHandlersForGuest(courseId: number, refresh?: boolean, navOptions?: any, admOptions?: any): Promise<boolean> {
        // Guest access.
        const accessData = {
            type: CoreCourseProvider.ACCESS_GUEST
        };

        return this.getHandlersForAccess(courseId, refresh, accessData, navOptions, admOptions).then((handlers) => {
            return !!(handlers && handlers.length);
        });
    }

    /**
     * Invalidate the data to be able to determine if handlers are enabled for a certain course.
     *
     * @param courseId Course ID.
     * @return Promise resolved when done.
     */
    invalidateCourseHandlers(courseId: number): Promise<any> {
        const promises = [],
            courseData = this.coursesHandlers[courseId];

        if (!courseData || !courseData.enabledHandlers) {
            return Promise.resolve();
        }

        courseData.enabledHandlers.forEach((handler) => {
            if (handler && handler.invalidateEnabledForCourse) {
                promises.push(Promise.resolve(
                    handler.invalidateEnabledForCourse(courseId, courseData.navOptions, courseData.admOptions)));
            }
        });

        return this.utils.allPromises(promises);
    }

    /**
     * Check if a time belongs to the last update handlers for course call.
     * This is to handle the cases where updateHandlersForCourse don't finish in the same order as they're called.
     *
     * @param courseId Course ID.
     * @param time Time to check.
     * @return Whether it's the last call.
     */
    isLastUpdateCourseCall(courseId: number, time: number): boolean {
        if (!this.lastUpdateHandlersForCoursesStart[courseId]) {
            return true;
        }

        return time == this.lastUpdateHandlersForCoursesStart[courseId];
    }

    /**
     * Load course options if missing.
     *
     * @param course The course object.
     * @param refresh True if it should refresh the list.
     * @return Promise resolved when done.
     */
    protected loadCourseOptions(course: any, refresh?: boolean): Promise<void> {
        if (this.coursesProvider.canGetAdminAndNavOptions() &&
                (typeof course.navOptions == 'undefined' || typeof course.admOptions == 'undefined' || refresh)) {

            return this.coursesProvider.getCoursesAdminAndNavOptions([course.id]).then((options) => {
                course.navOptions = options.navOptions[course.id];
                course.admOptions = options.admOptions[course.id];
            });
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Update handlers for each course.
     */
    updateData(): void {
        // Update handlers for all courses.
        for (const courseId in this.coursesHandlers) {
            const handler = this.coursesHandlers[courseId];
            this.updateHandlersForCourse(parseInt(courseId, 10), handler.access, handler.navOptions, handler.admOptions);
        }
    }

    /**
     * Update the handlers for a certain course.
     *
     * @param courseId The course ID.
     * @param accessData Access type and data. Default, guest, ...
     * @param navOptions Course navigation options for current user. See CoreCoursesProvider.getUserNavigationOptions.
     * @param admOptions Course admin options for current user. See CoreCoursesProvider.getUserAdministrationOptions.
     * @return Resolved when updated.
     */
    updateHandlersForCourse(courseId: number, accessData: any, navOptions?: any, admOptions?: any): Promise<any> {
        const promises = [],
            enabledForCourse = [],
            enabledForCourseMenu = [],
            siteId = this.sitesProvider.getCurrentSiteId(),
            now = Date.now();

        this.lastUpdateHandlersForCoursesStart[courseId] = now;

        for (const name in this.enabledHandlers) {
            const handler = <CoreCourseOptionsHandler> this.enabledHandlers[name];

            // Checks if the handler is enabled for the user.
            promises.push(Promise.resolve(handler.isEnabledForCourse(courseId, accessData, navOptions, admOptions))
                .then((enabled) => {
                    if (enabled) {
                        if (handler.isMenuHandler) {
                            enabledForCourseMenu.push(<CoreCourseOptionsMenuHandler> handler);
                        } else {
                            enabledForCourse.push(handler);
                        }
                    } else {
                        return Promise.reject(null);
                    }
                }).catch(() => {
                    // Nothing to do here, it is not enabled for this user.
                }));
        }

        return Promise.all(promises).then(() => {
            return true;
        }).catch(() => {
            // Never fails.
            return true;
        }).finally(() => {
            // Verify that this call is the last one that was started.
            // Check that site hasn't changed since the check started.
            if (this.isLastUpdateCourseCall(courseId, now) && this.sitesProvider.getCurrentSiteId() === siteId) {
                // Update the coursesHandlers array with the new enabled addons.
                this.coursesHandlers[courseId].enabledHandlers = enabledForCourse;
                this.coursesHandlers[courseId].enabledMenuHandlers = enabledForCourseMenu;
                this.loaded[courseId] = true;

                // Resolve the promise.
                this.coursesHandlers[courseId].deferred.resolve();
            }
        });
    }
}
