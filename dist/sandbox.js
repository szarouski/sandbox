/*! sandbox - v0.0.0 - 2014-09-19
* https://github.com/szarouski/sandbox
 Licensed http://unlicense.org/
* Description Sandbox with hierarchical support of event management
* Author Sergey Zarouski, http://webuniverse.club
*/

//TODO: look at closure compiler minifier
//TODO: add a way to plug-in
//TODO: most likely need namespaces
/*global window, IgnorePrivateSandboxValidation*/

//noinspection ThisExpressionReferencesGlobalObjectJS,FunctionTooLongJS
(function (root, factory) {
	//jshint maxcomplexity: false
    'use strict';
    if (typeof define === 'function' && define.amd) {
        define(['exports', '_', 'simple-permissions'], factory);
    } else if (typeof exports === 'object') {
        //noinspection JSCheckFunctionSignatures
	    factory(exports, require('_', 'simple-permissions'));
    } else {
	    var rootExports = root.exports || (root.exports = {});
	    //noinspection JSUnresolvedVariable
	    factory((rootExports.sandbox = {}), root._, root.exports.permissions);
    }
}(
	this,
    function initSandBox(
        /*Object*/exports,
        /*_.LoDashStatic*/_,
        /*PermissionsExports*/simplePermissions
	) {
        'use strict';
	    /**
	     * @name SandboxExports
	     * @type {{Sandbox: Sandbox, SandboxError: SandboxError}}
	     */

	    /**
	     * constructs a sandbox
	     * @param {String} [name] sandbox name
	     * @param {*} [data] stores data
	     * @name Sandbox
	     */
	    function Sandbox(name, data) {
		    if (typeof name !== 'string') {
			    data = name;
			    name = '';
		    }

		    name = getNotFalsy(name, _.uniqueId('empty'));
		    var parent = getCurrentParent();
		    var parentInfo = SandboxInfo.getFor(parent);
		    var prefix = createPrefix(parentInfo, name);
		    var childrenPrefix = prefix + '/' + _.uniqueId() + '/';

		    makeSureSiblingsNamesAreUnique(prefix, name);

		    var index = instanceReference.push(this) - 1;
		    new SandboxInfo(
			    {
				    name: name,
				    prefix: prefix,
				    childrenPrefix: childrenPrefix,
				    parentInfo: parentInfo,
				    data: data
			    }).mapTo(index);

		    new PrivateData().mapTo(prefix);
	    }
	    /**
	     * returns sandbox instance name
	     * @return {String} sandbox name
	     */
	    Sandbox.prototype.name = function getSandboxName() {
		    return SandboxInfo.getFor(this).name;
	    };
	    /**
	     * sets sandbox specific settings for cache adjustments, etc
	     * @param {Object} settings cache adjustment, etc
	     */
	    Sandbox.prototype.settings = function setSandboxSettings(settings) {
		    validateTypes(settings, _.isObject, 'settings should be an object');
		    var info = SandboxInfo.getFor(this);
		    info.settings = _.merge(info.settings, settings);
	    };
	    /**
	     * creates a new Sandbox instance, changes current parent, so that Sandbox constructor can create
	     * parent-child relations
	     * @return {Sandbox}
	     */
	    Sandbox.prototype.kid = function createSandboxKid() {
		    setCurrentParent(this);
		    var Factory = _.partial.apply(_, [Sandbox].concat(_.toArray(arguments)));
		    //noinspection JSValidateTypes
		    return new Factory();
	    };
	    /**
	     * returns immutable sandbox instance data
	     * @return {*} sandbox data
	     */
	    Sandbox.prototype.data = function getSandboxData() {
		    var data = SandboxInfo.getFor(this).data;
		    return _.isObject(data) ? _.create(data) : data;
	    };
	    /**
	     * subscribes handler to event
	     * @param {String} eventName event name
	     * @param {Function} handler event handler
	     * @param {Object} [thisBinding=this] this binding
	     */
	    Sandbox.prototype.on = function sandboxOn(eventName, handler, thisBinding) {
		    validateTypes(eventName, _.isString, 'eventName should be a string');
		    validateTypes(handler, _.isFunction, 'handler should be a function');

		    var that = this;
		    var info = SandboxInfo.getFor(that);
		    var thisPrefix = info.prefix;

		    var candidates = new CandidatesData();
		    candidates.addBy([info.parentPrefix, [info.siblingPrefixRegExp, info.chindrenPrefixRegExp]]);

		    var listener = new SandboxListener({
			    event: eventName,
			    handler: handler,
			    binding: getNotFalsy(thisBinding, that),
			    prefix: thisPrefix
		    });
		    var privateData = PrivateData.getFor(thisPrefix);
		    privateData.addListener(listener);

		    forValidPermissions(
			    candidates,
			    _.partial(permitIsValid, thisPrefix, eventName),
			    _.partial(SandboxListener.process, listener)
		    );

		    return that;
	    };
	    /**
	     * unsubscribes handlers from event
	     * @param {String} eventName event name
	     */
	    Sandbox.prototype.off = function sandboxOff(eventName) {
		    validateTypes(eventName, _.isString, 'eventName should be a string');

		    var that = this;
		    var info = SandboxInfo.getFor(that);
		    var privateData = PrivateData.getFor(info.prefix);

		    _.remove(privateData.listeners, function listenerEventMatchesEventName(listener) {
			    return listener.event === eventName;
		    });

		    return this;
	    };
	    /**
	     * emits event with given data
	     * @param {String} eventName event name
	     * @param {*} [data] event data
	     */
	    Sandbox.prototype.emit = function sandboxEmit(eventName, data) {
		    validateTypes(eventName, _.isString, 'eventName should be a string');

		    var that = this;
		    var info = SandboxInfo.getFor(that);

		    var cachedEvent = new CachedEvent({
			    origin: info.prefix,
			    event: eventName,
			    data: data,
			    invalidate: false,
			    settings: info.settings.cache
		    });

		    var candidates = new CandidatesData();
		    candidates.addBy([info.parentPrefix, [info.siblingPrefixRegExp, info.chindrenPrefixRegExp]]);

		    forValidPermissions(
			    candidates,
			    _.partial(permitIsValid, info.prefix, eventName),
			    _.partial(CachedEvent.process, cachedEvent)
		    );

		    return that;
	    };
	    /**
	     * @see emit
	     */
	    Sandbox.prototype.trigger = Sandbox.prototype.emit;
	    /**
	     * @param {function} updater
	     * @param {String|String[]} [target] sandbox candidate name(s) for permissions updating
	     * @param {Object.<String, String[]>} permissionsMap permissions map
	     * @this Sandbox
	     * @return {Sandbox}
	     */
	    var updatePermissions = function updatePermissions(target, permissionsMap, updater) {
		    if (arguments.length === 2) {
			    //noinspection JSValidateTypes
			    updater = permissionsMap;
			    permissionsMap = target;
			    target = undefined;
		    }

		    validateTypes(permissionsMap, _.isObject, 'permissionsMap should be an object');
		    validateTypes(updater, _.isFunction, 'updater should be a function');

		    var that = this;
		    var info = SandboxInfo.getFor(that);
		    var candidates = CandidatesData.getCandidatesForPermissions(that, target);
		    permissionsMap = keysToPrefixes(permissionsMap, info, that);
		    CandidatesData.updatePermissions(updater, candidates, permissionsMap);

		    return that;
	    };
	    //TODO: add a way to allow event(s) for all
	    /**
	     * grants permissions
	     * @param {String|String[]} [to] sandbox name(s) to grant permissions to
	     * @param {Object.<String, String[]>} permissionsMap permissions map
	     */
	    Sandbox.prototype.grant = _.partialRight(updatePermissions, function (data, prefix, permissionsMap) {
		    privateCodeTypeValidation(permissionsMap, _.isObject, 'permissionsMap should be an object');

		    simplePermissions.grant(data.permissions, prefix, permissionsMap);
	    });
	    /**
	     * revokes permissions
	     * @param {String|String[]} [from] sandbox name(s) to revoke permissions from
	     * @param {Object.<String, String[]>} permissionsMap permissions map
	     */
	    Sandbox.prototype.revoke = _.partialRight(updatePermissions, function (data, prefix, permissionsMap) {
		    privateCodeTypeValidation(permissionsMap, _.isObject, 'permissionsMap should be an object');

		    simplePermissions.revoke(data.permissions, prefix, permissionsMap);
		    _.remove(data.cache, function (/**CachedEvent*/cachedEvent) {
			    return cachedEvent.origin in permissionsMap &&
			           ~_.indexOf(permissionsMap[cachedEvent.origin], cachedEvent.event);
		    });
	    });
	    /**
	     * frees resources by removing links to private and info data
	     */
	    Sandbox.prototype.destroy = function destroySandbox() {
		    var info = SandboxInfo.getFor(this);
		    /**
		     * @type {PrivateData}
		     */
		    var privateData = PrivateData.getFor(info.prefix);
		    var index = _.indexOf(instanceReference, this);
		    instanceReference.splice(index, 1);
		    info.unMapFrom(index);
		    privateData.unMapFrom(info.prefix);
	    };

	    var defaultSettings = {
		    cache: {
			    store: true,
			    expire: 0, //off by default
			    debounce: true
		    }
	    };
	    /**
	     * updates default settings (caching, etc...)
	     * @param {Object} [newDefaults] defaults overwrites
	     * @return {Object} original or modified defaults
	     */
	    Sandbox.defaults = function sandboxDefaults(newDefaults) {
		    if (newDefaults) {
			    _.merge(defaultSettings, newDefaults);
		    }
		    return defaultSettings;
	    };


	    /**
	     * temporary parent, needed for children sandbox initialization
	     * @private
	     * @type {?Sandbox}
	     */
	    var tempParent = null;
	    /**
	     * after return sets temporary parent to null
	     * for kid proxy-initialization - returns temporary parent
	     * for sandboxes created directly with new Sandbox() - root object
	     * when root wasn't initialized - null
	     * @return {?Sandbox}
	     */
	    function getCurrentParent() {
		    var currentParent = tempParent || root || null;
		    tempParent = null;
		    return currentParent;
	    }
	    /**
	     * sets temporary parent to passed sandbox
	     * @param {Sandbox} parent
	     */
	    function setCurrentParent(parent) {
		    privateCodeTypeValidation(parent, isSandbox, 'parent should be an instance of Sandbox');

		    tempParent = parent;
	    }


	    /**
	     * keeps links to sandboxes, so that we internally can get an index of sandbox private data
	     * @private
	     * @type {Sandbox[]}
	     */
	    var instanceReference = [];
	    /**
	     * used to keep sandbox related information for easier sandbox info access
	     * @private
	     * @type {SandboxInfo[]}
	     */
	    var sandboxInfoStorage = [];
	    /**
	     * @class SandboxInfo
	     * @param {{name: String, prefix: String, childrenPrefix: string, parentInfo: ?SandboxInfo, data: *}} params
	     */
	    function SandboxInfo(params) {
		    privateCodeTypeValidation(
			    params,
			    function validateParams(value) {
				    return _.isObject(value) && _.isString(value.name) &&
				           _.isString(value.prefix) && _.isString(value.childrenPrefix);
			    },
			    'check signature {name: String, prefix: String, childrenPrefix: string}'
		    );

		    var sandboxPrefix = params.prefix;
		    var parentInfo = params.parentInfo;
		    var parentPrefix;

		    if (root) {
			    parentPrefix = parentInfo.prefix;
			    this.siblingPrefixRegExp = new RegExp(parentInfo.childrenPrefix + '[^/]*$');
		    } else {
			    parentPrefix = null;
			    this.siblingPrefixRegExp = null;
		    }

		    this.name = params.name;
		    this.prefix = sandboxPrefix;
		    this.parentPrefix = parentPrefix;
		    this.childrenPrefix = params.childrenPrefix;
		    this.parentInfo = parentInfo;
		    this.chindrenPrefixRegExp = new RegExp(sandboxPrefix + '.+');
		    /**
		     * @type {{cache: {store: boolean, expire: number, debounce: boolean}}}
		     */
		    this.settings = _.cloneDeep(defaultSettings);
		    this.data = params.data;
	    }
	    /**
	     * maps sandbox info to index in sandbox reference
	     * @param {Number} index
	     */
	    SandboxInfo.prototype.mapTo = function assignSandboxInfoTo(index) {
		    privateCodeTypeValidation(index, _.isNumber, 'index should be a number');

		    sandboxInfoStorage[index] = this;
	    };
	    /**
	     * un-maps sandbox info from sandbox instance reference
	     * @param {Number} index
	     */
	    SandboxInfo.prototype.unMapFrom = function unAssignSandboxInfoFrom(index) {
		    privateCodeTypeValidation(index, _.isNumber, 'index should be a number');

		    sandboxInfoStorage.splice(index, 1);
	    };
	    /**
	     * get instance info for sandbox
	     * @param {?Sandbox} sandbox
	     * @return {?SandboxInfo}
	     */
	    SandboxInfo.getFor = function getSandboxInfo(sandbox) {
		    if (sandbox) {
			    return sandboxInfoStorage[_.indexOf(instanceReference, sandbox)];
		    }
		    return null;
	    };


	    /**
	     * make sure that prefix doesn't exist in private data, otherwise throw an error
	     * @param {String} prefix
	     * @param {String} name
	     * @throws SandboxError
	     */
	    function makeSureSiblingsNamesAreUnique(prefix, name) {
		    privateCodeTypeValidation(prefix, _.isString, 'prefix should be a string');
		    privateCodeTypeValidation(name, _.isString, 'name should be a string');
		    if (prefix in privateDataStorage) {
			    throw new SandboxError(
				    [
					    'Siblings can\'t have same names. ',
					    name,
					    ' already exists.'
				    ].join('')
			    );
		    }
	    }


	    /**
	     * keeps reference to sandbox private data, accessible via prefix
	     * @type {Object.<String, PrivateData>}
	     */
	    var privateDataStorage = {};
	    /**
	     * stores listeners, cache and permissions
	     * @class PrivateData
	     */
	    function PrivateData() {
		    /**
		     * @type {SandboxListener[]}
		     */
		    this.listeners = [];
		    this.cache = [];
		    this.permissions = [];
	    }
	    /**
	     * maps private data to storage via prefix
	     * @param {String} prefix
	     */
	    PrivateData.prototype.mapTo = function mapTo(prefix) {
		    privateCodeTypeValidation(prefix, _.isString, 'prefix should be a string');
		    privateDataStorage[prefix] = this;
	    };
	    /**
	     * un-maps private data from storage via prefix
	     * @param {String} prefix
	     */
	    PrivateData.prototype.unMapFrom = function unMapPrivateDataFrom(prefix) {
		    privateCodeTypeValidation(prefix, _.isString, 'prefix should be a string');
		    delete privateDataStorage[prefix];
	    };
	    /**
	     * adds event to cache storage
	     * @param {CachedEvent} event
	     */
	    PrivateData.prototype.addToCache = function addToPrivateDataCache(event) {
		    privateCodeTypeValidation(event, isCachedEvent, 'event should be an instance of CachedEvent');
		    this.cache.push(event);

		    if (event.settings.expire) {
			    event.setupExpirationFor(this);
		    }
	    };
	    /**
	     * adds listener to storage
	     * @param {SandboxListener} listenerInfo
	     */
	    PrivateData.prototype.addListener = function addListener(listenerInfo) {
		    this.listeners.push(listenerInfo);
	    };
	    /**
	     * stores event in cache if no listeners were called for it
	     * @param {CachedEvent} event
	     */
	    PrivateData.prototype.processEvent = function processEvent(event) {
		    var listeners = event.filterEventListeners(this.listeners);
		    var storeInCache = event.settings.store && !listeners.length;

			SandboxListener.callEventListeners(listeners, event);

		    if (storeInCache) {
			    this.addToCache(event);
		    }
	    };
	    /**
	     * gets private data from storage by prefix
	     * @param {String} prefix
	     * @return {PrivateData}
	     */
	    PrivateData.getFor = function getPrivateData(prefix) {
		    return privateDataStorage[prefix];
	    };
	    /**
	     * returns simple object were key is prefix and value is related private data
	     * @param {String} prefix
	     * @return {Object.<String, PrivateData>}
	     */
	    PrivateData.getWrappedBy = function getPrivateDataGetWrappedBy(prefix) {
		    return makeSimpleObject(prefix, PrivateData.getFor(prefix));
	    };
	    /**
	     * finds private data objects, where keys match regular expressions
	     * and returns object where keys are prefixes and values are related private data
	     * @param {RegExp|RegExp[]} regExpOrArray
	     * @return {Object.<String, PrivateData>}
	     */
	    PrivateData.getByRegExp = function getPrivateDataByRegExp(regExpOrArray) {
		    var regExes = ensureIsArray(regExpOrArray);
		    return _.pick(privateDataStorage, function (data, prefix) {
			    return _.some(regExes, function (regExp) {
				    return regExp.test(prefix);
			    });
		    });
	    };


	    /**
	     * @class SandboxListener
	     * @param {{event: String, handler: Function, binding: Object}} params
	     */
	    function SandboxListener(params) {
		    this.event = params.event;
		    this.handler = params.handler;
		    this.binding = params.binding;
		    this.prefix = params.prefix;
	    }
	    /**
	     * finds cached events for candidates and call all listeners
	     * retrieved from current listener's private data
	     * @param {SandboxListener} listener
	     * @param {PrivateData} candidateData
	     * @param {String} candidatePrefix
	     */
	    SandboxListener.process = function processSandboxListener(listener, candidateData, candidatePrefix) {
		    var storedCandidates = this;
		    var privateData = storedCandidates.getFor(listener.prefix);
		    var candidateCachedEvents = _.filter(candidateData.cache, {event: listener.event});

		    _.each(candidateCachedEvents, _.partial(SandboxListener.callEventListeners, privateData.listeners));
	    };
	    /**
	     * calls event listeners for given event
	     * @param {SandboxListener[]} listeners
	     * @param {CachedEvent} event
	     */
	    SandboxListener.callEventListeners = function callEventListeners(listeners, event) {
		    _.each(listeners, function (/**SandboxListener*/listener) {
			    listener.handler.apply(listener.binding, ensureIsArray(event.data));
			    event.updateExpiration();
		    });
	    };




	    /**
	     * stores multiple private data, accessible by prefix
	     * @class CandidatesData
	     */
	    function CandidatesData() {
		    /**
		     * @param {Object.<String, PrivateData>} data
		     */
		    this.storage = {};
	    }
	    /**
	     * adds private data to storage via string or regular expression prefix
	     * @param {Array.<String|RegExp|RegExp[]>} prefixes
	     */
	    CandidatesData.prototype.addBy = function addCandidatesDataBy(prefixes) {
		    var that = this;
		    _.each(prefixes, function (prefix) {
			    var data;
			    if (typeof prefix === 'string') {
				    data = PrivateData.getWrappedBy(prefix);
			    } else {
				    data = PrivateData.getByRegExp(prefix);
			    }

			    _.extend(
				    that.storage,
				    data
			    );
		    });

		    return that;
	    };
	    /**
	     * gets private data by prefix
	     * @param {String} prefix
	     * @return {PrivateData}
	     */
	    CandidatesData.prototype.getFor = function getCandidatesData(prefix) {
		    return this.storage[prefix];
	    };
	    /**
	     * filters storage by prefixes
	     * @param {String[]} prefixes
	     */
	    CandidatesData.prototype.getFilteredByPrefix = function getFilteredCandidatesByPrefix(prefixes) {
		    return _.pick(
			    this.storage,
			    function pickCandidatesByName(candidateData, candidatePrefix) {
				    return ~_.indexOf(prefixes, candidatePrefix);
			    }
		    );
	    };
	    /**
	     * gets candidates for permissions filtered by target name(s)
	     * @param {Sandbox} sandbox
	     * @param {String|String[]} [target] sandbox name(s) to grant permissions to
	     * @return {Object.<String, PrivateData[]>}
	     */
	    CandidatesData.getCandidatesForPermissions = function getCandidatesForPermissions(sandbox, target) {
		    //jshint validthis: true
		    var info = SandboxInfo.getFor(sandbox);
		    var candidates = new CandidatesData();
		    candidates.addBy([info.prefix, info.chindrenPrefixRegExp]);

		    target = getPrefixForName(target, info, sandbox);

		    return candidates.getFilteredByPrefix(target);
	    };
	    /**
	     * updates candidate permissions
	     * @param {function (PrivateData, String, Object.<String, String[])} updater
	     * @param {Object.<String, PrivateData[]>} candidates
	     * @param {Object.<String, String[]>} permissionsMap
	     */
	    CandidatesData.updatePermissions = function updateCandidatesPermissions(updater, candidates, permissionsMap) {
		    _.each(candidates, function (data, prefix) {
			    updater(data, prefix, permissionsMap);
		    });
	    };


	    /**
	     * @class CachedEvent
	     * @param {{event: String, data: *, invalidate: boolean,
	     * settings: {store: boolean, expire: number, debounce: boolean}}} params
	     */
	    function CachedEvent(params) {
		    this.origin = params.origin;
		    this.event = params.event;
		    this.data = params.data;
		    this.invalidate = params.invalidate;
		    this.settings = params.settings;
	    }

	    /**
	     * @param {SandboxListener[]} listeners
	     * @return {SandboxListener[]}
	     */
	    CachedEvent.prototype.filterEventListeners = function filterEventListeners(listeners) {
		    return _.filter(listeners, {event: this.event});
	    };
	    /**
	     * tries to invalidate event expiration
	     */
	    CachedEvent.prototype.updateExpiration = function updateEventExpiration() {
		    if (typeof this.invalidate === 'function') {
			    this.invalidate();
		    }
	    };
	    /**
	     * creates expiration time for event
	     * @param {PrivateData} candidateData
	     */
	    CachedEvent.prototype.setupExpirationFor = function setupEventExpirationFor(candidateData) {
		    var cachedEvent = this;
		    var cacheSettings = cachedEvent.settings;

		    function removeEventFromCache() {
			    cachedEvent.removeFrom(candidateData.cache);
		    }

		    if (cacheSettings.debounce) {
			    cachedEvent.invalidate = _.debounce(removeEventFromCache, cacheSettings.expire);
			    cachedEvent.invalidate();
		    } else {
			    _.delay(removeEventFromCache, cacheSettings.expire);
		    }
	    };
	    /**
	     * @param {[]} cache
	     */
	    CachedEvent.prototype.removeFrom = function removeEventFromCache(cache) {
		    var index = _.findIndex(cache, this);
		    if (~index) {
			    cache.splice(index, 1);
		    }
	    };
	    /**
	     * @param {CachedEvent} event
	     * @param {PrivateData} candidateData
	     * @param {String} candidatePrefix
	     */
	    CachedEvent.process = function processCachedEvent(event, candidateData, candidatePrefix) {
		    candidateData.processEvent(event);
	    };


	    /**
	     * creates sandbox error
	     * @param {String} message
	     * @class SandboxError
	     */
	    function SandboxError(message) {
		    this.message = message;
	    }
	    SandboxError.prototype = new Error();
	    SandboxError.prototype.constructor = SandboxError;


	    /**
	     * @name TypeValidatorInfo
	     * @type {{value: *, validator: Function, errorMessage: String}}
	     */

	    /**
	     * @param {*} value
	     * @param {Function} validator
	     * @param {String} errorMessage
	     * @throws SandboxError
	     */
	    var validateTypes = function validateTypes(value, validator, errorMessage) {
		    if (!validator(value)) {
			    throw new SandboxError(errorMessage + ', received type: ' + typeof value);
		    }
	    };
	    /**
	     * @param {*} value
	     * @param {Function} validator
	     * @param {String} errorMessage
	     * @throws SandboxError
	     */
	    var privateCodeTypeValidation = function privateCodeTypeValidation(value, validator, errorMessage) {
		    if (typeof IgnorePrivateSandboxValidation !== 'undefined' && !IgnorePrivateSandboxValidation) {
			    validateTypes.apply(null, arguments);
		    }
	    };


	    /**
	     * validates source prefix against candidate's permissions for a given permit
	     * if source's prefix is the same as candidate's, permit is not required
	     * @param {String} sourcePrefix
	     * @param {String} permit
	     * @param {PrivateData} candidateData
	     * @param {String} candidatePrefix
	     * @return {boolean}
	     */
	    function permitIsValid(sourcePrefix, permit, candidateData, candidatePrefix) {
		    var allowEverythingForSource = candidatePrefix === sourcePrefix;
		    return allowEverythingForSource || hasPermitByPrefixes(
			    candidateData.permissions,
			    permit,
			    sourcePrefix,
			    candidatePrefix
		    );
	    }

        /**
         * checks if source could be found by prefix and contains permit
         * @param {Array} source
         * @param {String} permit
         * @param {String} sourcePrefix
         * @param {String} candidatePrefix
         * @return {boolean}
         */
        function hasPermitByPrefixes(source, permit, sourcePrefix, candidatePrefix) {
	        var permissionsMapForPrefix = _.find(source, function findByPrefixes(/**Entry*/entry) {
		        return sourcePrefix === entry.source && candidatePrefix === entry.target;
	        });
	        return !!(permissionsMapForPrefix && ~_.indexOf(permissionsMapForPrefix.permissions, permit));
        }

        /**
         * executes callback for candidates which pass validation
         * @param {CandidatesData} candidates
         * @param {Function} validator
         * @param {Function} callback
         */
        function forValidPermissions(candidates, validator, callback) {
	        _.each(candidates.storage, function (candidateData, prefix) {
		        var args = _.toArray(arguments);
		        if (validator.apply(candidates, args)) {
			        callback.apply(candidates, args);
		        }
	        });
        }

	    /**
	     * @param {*} param
	     * @return {[]}
	     */
        function ensureIsArray(param) {
	        return _.isArray(param) ? param : [param];
        }


	    /**
	     * @param {SandboxInfo} parentData
	     * @param {String} name
	     * @return {String}
	     */
	    function createPrefix(parentData, name) {
		    if (!root) { //root wasn't initialized yet
			    return rootName;
		    }

		    return parentData.childrenPrefix + name;
	    }
	    /**
	     * returns new object where instead of name keys it has prefix keys
	     * @param {Object.<String, String[]>} obj
	     * @param {SandboxInfo} info
	     * @param {Sandbox} sandbox
	     * @return {Object.<String, String[]>}
	     */
	    function keysToPrefixes(obj, info, sandbox) {
		    var keys = _.map(obj, function (value, key) {
			    return getPrefixForName(key, info, sandbox);
		    });
		    var values = _.values(obj);
		    return _.object(keys, values);
	    }
	    /**
	     * @param {String|String[]} target
	     * @param {SandboxInfo} info
	     * @param {Sandbox} sandbox
	     * @return {[]}
	     */
	    function getPrefixForName(target, info, sandbox) {
		    var sandboxName = sandbox.name();
		    if (target && target !== sandboxName) {
			    return nameToPrefix(target, info);
		    } else {
			    return nameToPrefix(sandboxName, info.parentInfo);
		    }
	    }
	    /**
	     * @param {String|String[]} to name(s)
	     * @param {SandboxInfo} info
	     * @return {[]}
	     */
	    function nameToPrefix(to, info) {
		    if (_.isArray(to)) {
			    return _.map(to, function (target) {
				    return info.childrenPrefix + target;
			    });
		    } else {
			    return [info.childrenPrefix + to];
		    }
	    }


	    /**
	     * gets first not falsy value
	     * @param {*} initialValue
	     * @param {*} fallbackValue
	     * @return {*}
	     */
	    function getNotFalsy(initialValue, fallbackValue) {
		    return initialValue || fallbackValue;
	    }


	    /**
	     * returns object with a single key
	     * @param {String} key
	     * @param {*} value
	     * @return {{}}
	     */
	    function makeSimpleObject(key, value) {
		    var obj = {};
		    obj[key] = value;
		    return obj;
	    }


	    /**
	     * checks that value is a sandbox instance
	     * @param {*} value
	     * @return {boolean}
	     */
	    function isSandbox(value) {
		    return value instanceof Sandbox;
	    }
	    /**
	     * checks that value is a CachedEvent instance
	     * @param {*} value
	     * @return {boolean}
	     */
	    function isCachedEvent(value) {
		    return value instanceof CachedEvent;
	    }


	    var rootName = '√';
	    var root = new Sandbox(rootName);

	    exports.Sandbox = Sandbox;
	    exports.SandboxError = SandboxError;
    })
);