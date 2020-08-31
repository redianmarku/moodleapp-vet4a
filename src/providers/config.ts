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

import { Injectable } from '@angular/core';
import { CoreAppProvider, CoreAppSchema } from './app';
import { SQLiteDB } from '@classes/sqlitedb';
import { makeSingleton } from '@singletons/core.singletons';

/**
 * Factory to provide access to dynamic and permanent config and settings.
 * It should not be abused into a temporary storage.
 */
@Injectable()
export class CoreConfigProvider {
    protected appDB: SQLiteDB;
    protected TABLE_NAME = 'core_config';
    protected tableSchema: CoreAppSchema = {
        name: 'CoreConfigProvider',
        version: 1,
        tables: [
            {
                name: this.TABLE_NAME,
                columns: [
                    {
                        name: 'name',
                        type: 'TEXT',
                        unique: true,
                        notNull: true
                    },
                    {
                        name: 'value'
                    },
                ],
            },
        ],
    };

    protected dbReady: Promise<any>; // Promise resolved when the app DB is initialized.

    constructor(appProvider: CoreAppProvider) {
        this.appDB = appProvider.getDB();
        this.dbReady = appProvider.createTablesFromSchema(this.tableSchema).catch(() => {
            // Ignore errors.
        });
    }

    /**
     * Deletes an app setting.
     *
     * @param name The config name.
     * @return Promise resolved when done.
     */
    async delete(name: string): Promise<any> {
        await this.dbReady;

        return this.appDB.deleteRecords(this.TABLE_NAME, { name: name });
    }

    /**
     * Get an app setting.
     *
     * @param name The config name.
     * @param defaultValue Default value to use if the entry is not found.
     * @return Resolves upon success along with the config data. Reject on failure.
     */
    async get(name: string, defaultValue?: any): Promise<any> {
        await this.dbReady;

        try {
            const entry = await this.appDB.getRecord(this.TABLE_NAME, { name: name });

            return entry.value;
        } catch (error) {
            if (typeof defaultValue != 'undefined') {
                return defaultValue;
            }

            throw error;
        }
    }

    /**
     * Set an app setting.
     *
     * @param name The config name.
     * @param value The config value. Can only store number or strings.
     * @return Promise resolved when done.
     */
    async set(name: string, value: number | string): Promise<any> {
        await this.dbReady;

        return this.appDB.insertRecord(this.TABLE_NAME, { name: name, value: value });
    }
}

export class CoreConfig extends makeSingleton(CoreConfigProvider) {}
