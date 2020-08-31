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
import { HttpInterceptor, HttpHandler, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Interceptor for Http calls. Adds the header 'Content-Type'='application/x-www-form-urlencoded'
 * and serializes the parameters if needed.
 */
@Injectable()
export class CoreInterceptor implements HttpInterceptor {

    constructor() {
        // Nothing to do.
    }

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<any> {
        // Add the header and serialize the body if needed.
        const newReq = req.clone({
            headers: req.headers.set('Content-Type', 'application/x-www-form-urlencoded'),
            body: typeof req.body == 'object' && String(req.body) != '[object File]' ?
                CoreInterceptor.serialize(req.body) : req.body
        });

        // Pass on the cloned request instead of the original request.
        return next.handle(newReq);
    }

    /**
     * Serialize an object to be used in a request.
     *
     * @param obj Object to serialize.
     * @param addNull Add null values to the serialized as empty parameters.
     * @return Serialization of the object.
     */
    static serialize(obj: any, addNull?: boolean): string {
        let query = '',
            fullSubName,
            subValue,
            innerObj;

        for (const name in obj) {
            const value = obj[name];

            if (value instanceof Array) {
                for (let i = 0; i < value.length; ++i) {
                    subValue = value[i];
                    fullSubName = name + '[' + i + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += this.serialize(innerObj) + '&';
                }
            } else if (value instanceof Object) {
                for (const subName in value) {
                    subValue = value[subName];
                    fullSubName = name + '[' + subName + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += this.serialize(innerObj) + '&';
                }
            } else if (addNull || (typeof value != 'undefined' && value !== null)) {
                query += encodeURIComponent(name) + '=' + encodeURIComponent(value) + '&';
            }
        }

        return query.length ? query.substr(0, query.length - 1) : query;
    }
}
