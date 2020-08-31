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

import { Component, ViewChild } from '@angular/core';
import { IonicPage, Segment } from 'ionic-angular';
import { CoreConstants } from '@core/constants';
import { CoreConfigProvider } from '@providers/config';
import { CoreFileProvider } from '@providers/file';
import { CoreEventsProvider } from '@providers/events';
import { CoreLangProvider } from '@providers/lang';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CorePushNotificationsProvider } from '@core/pushnotifications/providers/pushnotifications';
import { CoreConfigConstants } from '../../../../configconstants';
import { CoreSettingsHelper } from '../../providers/helper';

/**
 * Page that displays the general settings.
 */
@IonicPage({segment: 'core-settings-general'})
@Component({
    selector: 'page-core-settings-general',
    templateUrl: 'general.html',
})
export class CoreSettingsGeneralPage {

    languages = [];
    selectedLanguage: string;
    fontSizes = [];
    selectedFontSize: string;
    rteSupported: boolean;
    richTextEditor: boolean;
    debugDisplay: boolean;
    analyticsSupported: boolean;
    analyticsEnabled: boolean;
    colorSchemes = [];
    selectedScheme: string;
    colorSchemeDisabled: boolean;

    constructor(protected configProvider: CoreConfigProvider,
            fileProvider: CoreFileProvider,
            protected eventsProvider: CoreEventsProvider,
            protected langProvider: CoreLangProvider,
            protected domUtils: CoreDomUtilsProvider,
            protected pushNotificationsProvider: CorePushNotificationsProvider,
            protected settingsHelper: CoreSettingsHelper) {

        // Get the supported languages.
        const languages = CoreConfigConstants.languages;
        for (const code in languages) {
            this.languages.push({
                code: code,
                name: languages[code]
            });
        }

        if (!CoreConfigConstants.forceColorScheme) {
            this.colorSchemeDisabled = this.settingsHelper.isColorSchemeDisabledInSite();

            if (this.colorSchemeDisabled) {
                this.colorSchemes.push('light');
                this.selectedScheme = this.colorSchemes[0];
            } else {
                let defaultColorScheme = 'light';

                if (window.matchMedia('(prefers-color-scheme: dark)').matches ||
                                    window.matchMedia('(prefers-color-scheme: light)').matches) {
                    this.colorSchemes.push('auto');
                    defaultColorScheme = 'auto';
                }
                this.colorSchemes.push('light');
                this.colorSchemes.push('dark');

                this.configProvider.get(CoreConstants.SETTINGS_COLOR_SCHEME, defaultColorScheme).then((scheme) => {
                    this.selectedScheme = scheme;
                });
            }
        }

        // Sort them by name.
        this.languages.sort((a, b) => {
            return a.name.localeCompare(b.name);
        });

        langProvider.getCurrentLanguage().then((currentLanguage) => {
            this.selectedLanguage = currentLanguage;
        });

        this.configProvider.get(CoreConstants.SETTINGS_FONT_SIZE, CoreConfigConstants.font_sizes[0].toString()).then((fontSize) => {
            this.selectedFontSize = fontSize;
            this.fontSizes = CoreConfigConstants.font_sizes.map((size) => {
                return {
                    size: size,
                    // Absolute pixel size based on 1.4rem body text when this size is selected.
                    style: Math.round(size * 16 * 1.4 / 100),
                    selected: size === this.selectedFontSize
                };
            });
            // Workaround for segment control bug https://github.com/ionic-team/ionic/issues/6923, fixed in Ionic 4 only.
            setTimeout(() => {
                if (this.segment) {
                    this.segment.ngAfterContentInit();
                }
            });
        });

        this.rteSupported = this.domUtils.isRichTextEditorSupported();
        if (this.rteSupported) {
            this.configProvider.get(CoreConstants.SETTINGS_RICH_TEXT_EDITOR, true).then((richTextEditorEnabled) => {
                this.richTextEditor = !!richTextEditorEnabled;
            });
        }

        this.configProvider.get(CoreConstants.SETTINGS_DEBUG_DISPLAY, false).then((debugDisplay) => {
            this.debugDisplay = !!debugDisplay;
        });

        this.analyticsSupported = CoreConfigConstants.enableanalytics;
        if (this.analyticsSupported) {
            this.configProvider.get(CoreConstants.SETTINGS_ANALYTICS_ENABLED, true).then((enabled) => {
                this.analyticsEnabled = !!enabled;
            });
        }
    }

    @ViewChild(Segment)
    private segment: Segment;

    /**
     * Called when a new language is selected.
     */
    languageChanged(): void {
        this.langProvider.changeCurrentLanguage(this.selectedLanguage).finally(() => {
            this.eventsProvider.trigger(CoreEventsProvider.LANGUAGE_CHANGED, this.selectedLanguage);
        });
    }

    /**
     * Called when a new font size is selected.
     */
    fontSizeChanged(): void {
        this.fontSizes = this.fontSizes.map((fontSize) => {
            fontSize.selected = fontSize.size === this.selectedFontSize;

            return fontSize;
        });

        this.settingsHelper.setFontSize(this.selectedFontSize);
        this.configProvider.set(CoreConstants.SETTINGS_FONT_SIZE, this.selectedFontSize);
    }

    /**
     * Called when a new color scheme is selected.
     */
    colorSchemeChanged(): void {
        this.settingsHelper.setColorScheme(this.selectedScheme);
        this.configProvider.set(CoreConstants.SETTINGS_COLOR_SCHEME, this.selectedScheme);
    }

    /**
     * Called when the rich text editor is enabled or disabled.
     */
    richTextEditorChanged(): void {
        this.configProvider.set(CoreConstants.SETTINGS_RICH_TEXT_EDITOR, this.richTextEditor ? 1 : 0);
    }

    /**
     * Called when the debug display setting is enabled or disabled.
     */
    debugDisplayChanged(): void {
        this.configProvider.set(CoreConstants.SETTINGS_DEBUG_DISPLAY, this.debugDisplay ? 1 : 0);
        this.domUtils.setDebugDisplay(this.debugDisplay);
    }

    /**
     * Called when the analytics setting is enabled or disabled.
     */
    analyticsEnabledChanged(): void {
        this.pushNotificationsProvider.enableAnalytics(this.analyticsEnabled).then(() => {
            this.configProvider.set(CoreConstants.SETTINGS_ANALYTICS_ENABLED, this.analyticsEnabled ? 1 : 0);
        });
    }
}
