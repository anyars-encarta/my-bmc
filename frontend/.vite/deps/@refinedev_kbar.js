"use client";
import {
  require_react_dom
} from "./chunk-X7CDTWTX.js";
import {
  require_jsx_runtime,
  useCanWithoutCache,
  useDelete,
  useGetToPath,
  useGo,
  useResourceParams,
  useTranslate,
  useUserFriendlyName
} from "./chunk-SYPME2GI.js";
import "./chunk-NWHHQHUP.js";
import {
  __commonJS,
  __esm,
  __export,
  __toCommonJS,
  __toESM,
  require_react
} from "./chunk-7W76HJBA.js";

// node_modules/kbar/lib/utils.js
var require_utils = __commonJS({
  "node_modules/kbar/lib/utils.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __spreadArray = exports && exports.__spreadArray || function(to, from, pack) {
      if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
        }
      }
      return to.concat(ar || Array.prototype.slice.call(from));
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Priority = exports.isModKey = exports.shouldRejectKeystrokes = exports.useThrottledValue = exports.getScrollbarWidth = exports.useIsomorphicLayout = exports.noop = exports.createAction = exports.randomId = exports.usePointerMovedSinceMount = exports.useOuterClick = exports.swallowEvent = void 0;
    var React6 = __importStar(require_react());
    function swallowEvent(event) {
      event.stopPropagation();
      event.preventDefault();
    }
    exports.swallowEvent = swallowEvent;
    function useOuterClick(dom, cb) {
      var cbRef = React6.useRef(cb);
      cbRef.current = cb;
      React6.useEffect(function() {
        function handler(event) {
          var _a, _b;
          if (((_a = dom.current) === null || _a === void 0 ? void 0 : _a.contains(event.target)) || // Add support for ReactShadowRoot
          // @ts-expect-error wrong types, the `host` property exists https://stackoverflow.com/a/25340456
          event.target === ((_b = dom.current) === null || _b === void 0 ? void 0 : _b.getRootNode().host)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          cbRef.current();
        }
        window.addEventListener("pointerdown", handler, true);
        return function() {
          return window.removeEventListener("pointerdown", handler, true);
        };
      }, [dom]);
    }
    exports.useOuterClick = useOuterClick;
    function usePointerMovedSinceMount() {
      var _a = React6.useState(false), moved = _a[0], setMoved = _a[1];
      React6.useEffect(function() {
        function handler() {
          setMoved(true);
        }
        if (!moved) {
          window.addEventListener("pointermove", handler);
          return function() {
            return window.removeEventListener("pointermove", handler);
          };
        }
      }, [moved]);
      return moved;
    }
    exports.usePointerMovedSinceMount = usePointerMovedSinceMount;
    function randomId() {
      return Math.random().toString(36).substring(2, 9);
    }
    exports.randomId = randomId;
    function createAction3(params) {
      return __assign({ id: randomId() }, params);
    }
    exports.createAction = createAction3;
    function noop() {
    }
    exports.noop = noop;
    exports.useIsomorphicLayout = typeof window === "undefined" ? noop : React6.useLayoutEffect;
    function getScrollbarWidth() {
      var outer = document.createElement("div");
      outer.style.visibility = "hidden";
      outer.style.overflow = "scroll";
      document.body.appendChild(outer);
      var inner = document.createElement("div");
      outer.appendChild(inner);
      var scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
      outer.parentNode.removeChild(outer);
      return scrollbarWidth;
    }
    exports.getScrollbarWidth = getScrollbarWidth;
    function useThrottledValue(value, ms) {
      if (ms === void 0) {
        ms = 100;
      }
      var _a = React6.useState(value), throttledValue = _a[0], setThrottledValue = _a[1];
      var lastRan = React6.useRef(Date.now());
      React6.useEffect(function() {
        if (ms === 0)
          return;
        var timeout = setTimeout(function() {
          setThrottledValue(value);
          lastRan.current = Date.now();
        }, lastRan.current - (Date.now() - ms));
        return function() {
          clearTimeout(timeout);
        };
      }, [ms, value]);
      return ms === 0 ? value : throttledValue;
    }
    exports.useThrottledValue = useThrottledValue;
    function shouldRejectKeystrokes(_a) {
      var _b, _c;
      var _d = _a === void 0 ? { ignoreWhenFocused: [] } : _a, ignoreWhenFocused = _d.ignoreWhenFocused;
      var inputs = __spreadArray(["input", "textarea"], ignoreWhenFocused, true).map(function(el) {
        return el.toLowerCase();
      });
      var activeElement = document.activeElement;
      var ignoreStrokes = activeElement && (inputs.indexOf(activeElement.tagName.toLowerCase()) !== -1 || ((_b = activeElement.attributes.getNamedItem("role")) === null || _b === void 0 ? void 0 : _b.value) === "textbox" || ((_c = activeElement.attributes.getNamedItem("contenteditable")) === null || _c === void 0 ? void 0 : _c.value) === "true");
      return ignoreStrokes;
    }
    exports.shouldRejectKeystrokes = shouldRejectKeystrokes;
    var SSR = typeof window === "undefined";
    var isMac = !SSR && window.navigator.platform === "MacIntel";
    function isModKey(event) {
      return isMac ? event.metaKey : event.ctrlKey;
    }
    exports.isModKey = isModKey;
    exports.Priority = {
      HIGH: 1,
      NORMAL: 0,
      LOW: -1
    };
  }
});

// node_modules/fast-equals/dist/fast-equals.js
var require_fast_equals = __commonJS({
  "node_modules/fast-equals/dist/fast-equals.js"(exports, module) {
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global["fast-equals"] = {}));
    })(exports, (function(exports2) {
      "use strict";
      var HAS_WEAKSET_SUPPORT = typeof WeakSet === "function";
      var keys = Object.keys;
      function sameValueZeroEqual(a, b) {
        return a === b || a !== a && b !== b;
      }
      function isPlainObject(value) {
        return value.constructor === Object || value.constructor == null;
      }
      function isPromiseLike(value) {
        return !!value && typeof value.then === "function";
      }
      function isReactElement(value) {
        return !!(value && value.$$typeof);
      }
      function getNewCacheFallback() {
        var values = [];
        return {
          add: function(value) {
            values.push(value);
          },
          has: function(value) {
            return values.indexOf(value) !== -1;
          }
        };
      }
      var getNewCache = (function(canUseWeakMap) {
        if (canUseWeakMap) {
          return function _getNewCache() {
            return /* @__PURE__ */ new WeakSet();
          };
        }
        return getNewCacheFallback;
      })(HAS_WEAKSET_SUPPORT);
      function createCircularEqualCreator(isEqual) {
        return function createCircularEqual(comparator) {
          var _comparator = isEqual || comparator;
          return function circularEqual(a, b, cache) {
            if (cache === void 0) {
              cache = getNewCache();
            }
            var isCacheableA = !!a && typeof a === "object";
            var isCacheableB = !!b && typeof b === "object";
            if (isCacheableA || isCacheableB) {
              var hasA = isCacheableA && cache.has(a);
              var hasB = isCacheableB && cache.has(b);
              if (hasA || hasB) {
                return hasA && hasB;
              }
              if (isCacheableA) {
                cache.add(a);
              }
              if (isCacheableB) {
                cache.add(b);
              }
            }
            return _comparator(a, b, cache);
          };
        };
      }
      function areArraysEqual(a, b, isEqual, meta) {
        var index = a.length;
        if (b.length !== index) {
          return false;
        }
        while (index-- > 0) {
          if (!isEqual(a[index], b[index], meta)) {
            return false;
          }
        }
        return true;
      }
      function areMapsEqual(a, b, isEqual, meta) {
        var isValueEqual = a.size === b.size;
        if (isValueEqual && a.size) {
          var matchedIndices_1 = {};
          a.forEach(function(aValue, aKey) {
            if (isValueEqual) {
              var hasMatch_1 = false;
              var matchIndex_1 = 0;
              b.forEach(function(bValue, bKey) {
                if (!hasMatch_1 && !matchedIndices_1[matchIndex_1]) {
                  hasMatch_1 = isEqual(aKey, bKey, meta) && isEqual(aValue, bValue, meta);
                  if (hasMatch_1) {
                    matchedIndices_1[matchIndex_1] = true;
                  }
                }
                matchIndex_1++;
              });
              isValueEqual = hasMatch_1;
            }
          });
        }
        return isValueEqual;
      }
      var OWNER = "_owner";
      var hasOwnProperty = Function.prototype.bind.call(Function.prototype.call, Object.prototype.hasOwnProperty);
      function areObjectsEqual(a, b, isEqual, meta) {
        var keysA = keys(a);
        var index = keysA.length;
        if (keys(b).length !== index) {
          return false;
        }
        if (index) {
          var key = void 0;
          while (index-- > 0) {
            key = keysA[index];
            if (key === OWNER) {
              var reactElementA = isReactElement(a);
              var reactElementB = isReactElement(b);
              if ((reactElementA || reactElementB) && reactElementA !== reactElementB) {
                return false;
              }
            }
            if (!hasOwnProperty(b, key) || !isEqual(a[key], b[key], meta)) {
              return false;
            }
          }
        }
        return true;
      }
      function areRegExpsEqual(a, b) {
        return a.source === b.source && a.global === b.global && a.ignoreCase === b.ignoreCase && a.multiline === b.multiline && a.unicode === b.unicode && a.sticky === b.sticky && a.lastIndex === b.lastIndex;
      }
      function areSetsEqual(a, b, isEqual, meta) {
        var isValueEqual = a.size === b.size;
        if (isValueEqual && a.size) {
          var matchedIndices_2 = {};
          a.forEach(function(aValue) {
            if (isValueEqual) {
              var hasMatch_2 = false;
              var matchIndex_2 = 0;
              b.forEach(function(bValue) {
                if (!hasMatch_2 && !matchedIndices_2[matchIndex_2]) {
                  hasMatch_2 = isEqual(aValue, bValue, meta);
                  if (hasMatch_2) {
                    matchedIndices_2[matchIndex_2] = true;
                  }
                }
                matchIndex_2++;
              });
              isValueEqual = hasMatch_2;
            }
          });
        }
        return isValueEqual;
      }
      var HAS_MAP_SUPPORT = typeof Map === "function";
      var HAS_SET_SUPPORT = typeof Set === "function";
      function createComparator(createIsEqual) {
        var isEqual = (
          /* eslint-disable no-use-before-define */
          typeof createIsEqual === "function" ? createIsEqual(comparator) : comparator
        );
        function comparator(a, b, meta) {
          if (a === b) {
            return true;
          }
          if (a && b && typeof a === "object" && typeof b === "object") {
            if (isPlainObject(a) && isPlainObject(b)) {
              return areObjectsEqual(a, b, isEqual, meta);
            }
            var aShape = Array.isArray(a);
            var bShape = Array.isArray(b);
            if (aShape || bShape) {
              return aShape === bShape && areArraysEqual(a, b, isEqual, meta);
            }
            aShape = a instanceof Date;
            bShape = b instanceof Date;
            if (aShape || bShape) {
              return aShape === bShape && sameValueZeroEqual(a.getTime(), b.getTime());
            }
            aShape = a instanceof RegExp;
            bShape = b instanceof RegExp;
            if (aShape || bShape) {
              return aShape === bShape && areRegExpsEqual(a, b);
            }
            if (isPromiseLike(a) || isPromiseLike(b)) {
              return a === b;
            }
            if (HAS_MAP_SUPPORT) {
              aShape = a instanceof Map;
              bShape = b instanceof Map;
              if (aShape || bShape) {
                return aShape === bShape && areMapsEqual(a, b, isEqual, meta);
              }
            }
            if (HAS_SET_SUPPORT) {
              aShape = a instanceof Set;
              bShape = b instanceof Set;
              if (aShape || bShape) {
                return aShape === bShape && areSetsEqual(a, b, isEqual, meta);
              }
            }
            return areObjectsEqual(a, b, isEqual, meta);
          }
          return a !== a && b !== b;
        }
        return comparator;
      }
      var deepEqual = createComparator();
      var shallowEqual = createComparator(function() {
        return sameValueZeroEqual;
      });
      var circularDeepEqual = createComparator(createCircularEqualCreator());
      var circularShallowEqual = createComparator(createCircularEqualCreator(sameValueZeroEqual));
      exports2.circularDeepEqual = circularDeepEqual;
      exports2.circularShallowEqual = circularShallowEqual;
      exports2.createCustomEqual = createComparator;
      exports2.deepEqual = deepEqual;
      exports2.sameValueZeroEqual = sameValueZeroEqual;
      exports2.shallowEqual = shallowEqual;
      Object.defineProperty(exports2, "__esModule", { value: true });
    }));
  }
});

// node_modules/tiny-invariant/dist/tiny-invariant.cjs.js
var require_tiny_invariant_cjs = __commonJS({
  "node_modules/tiny-invariant/dist/tiny-invariant.cjs.js"(exports, module) {
    "use strict";
    var isProduction = false;
    var prefix = "Invariant failed";
    function invariant(condition, message) {
      if (condition) {
        return;
      }
      if (isProduction) {
        throw new Error(prefix);
      }
      var provided = typeof message === "function" ? message() : message;
      var value = provided ? "".concat(prefix, ": ").concat(provided) : prefix;
      throw new Error(value);
    }
    module.exports = invariant;
  }
});

// node_modules/kbar/lib/action/Command.js
var require_Command = __commonJS({
  "node_modules/kbar/lib/action/Command.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Command = void 0;
    var Command = (
      /** @class */
      /* @__PURE__ */ (function() {
        function Command2(command, options) {
          var _this = this;
          if (options === void 0) {
            options = {};
          }
          this.perform = function() {
            var negate = command.perform();
            if (typeof negate !== "function")
              return;
            var history = options.history;
            if (!history)
              return;
            if (_this.historyItem) {
              history.remove(_this.historyItem);
            }
            _this.historyItem = history.add({
              perform: command.perform,
              negate
            });
            _this.history = {
              undo: function() {
                return history.undo(_this.historyItem);
              },
              redo: function() {
                return history.redo(_this.historyItem);
              }
            };
          };
        }
        return Command2;
      })()
    );
    exports.Command = Command;
  }
});

// node_modules/kbar/lib/action/ActionImpl.js
var require_ActionImpl = __commonJS({
  "node_modules/kbar/lib/action/ActionImpl.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ActionImpl = void 0;
    var tiny_invariant_1 = __importDefault(require_tiny_invariant_cjs());
    var Command_1 = require_Command();
    var utils_1 = require_utils();
    var extendKeywords = function(_a) {
      var _b = _a.keywords, keywords = _b === void 0 ? "" : _b, _c = _a.section, section = _c === void 0 ? "" : _c;
      return (keywords + " " + (typeof section === "string" ? section : section.name)).trim();
    };
    var ActionImpl = (
      /** @class */
      (function() {
        function ActionImpl2(action, options) {
          var _this = this;
          var _a;
          this.priority = utils_1.Priority.NORMAL;
          this.ancestors = [];
          this.children = [];
          Object.assign(this, action);
          this.id = action.id;
          this.name = action.name;
          this.keywords = extendKeywords(action);
          var perform = action.perform;
          this.command = perform && new Command_1.Command({
            perform: function() {
              return perform(_this);
            }
          }, {
            history: options.history
          });
          this.perform = (_a = this.command) === null || _a === void 0 ? void 0 : _a.perform;
          if (action.parent) {
            var parentActionImpl = options.store[action.parent];
            (0, tiny_invariant_1.default)(parentActionImpl, "attempted to create an action whos parent: " + action.parent + " does not exist in the store.");
            parentActionImpl.addChild(this);
          }
        }
        ActionImpl2.prototype.addChild = function(childActionImpl) {
          childActionImpl.ancestors.unshift(this);
          var parent = this.parentActionImpl;
          while (parent) {
            childActionImpl.ancestors.unshift(parent);
            parent = parent.parentActionImpl;
          }
          this.children.push(childActionImpl);
        };
        ActionImpl2.prototype.removeChild = function(actionImpl) {
          var _this = this;
          var index = this.children.indexOf(actionImpl);
          if (index !== -1) {
            this.children.splice(index, 1);
          }
          if (actionImpl.children) {
            actionImpl.children.forEach(function(child) {
              _this.removeChild(child);
            });
          }
        };
        Object.defineProperty(ActionImpl2.prototype, "parentActionImpl", {
          // easily access parentActionImpl after creation
          get: function() {
            return this.ancestors[this.ancestors.length - 1];
          },
          enumerable: false,
          configurable: true
        });
        ActionImpl2.create = function(action, options) {
          return new ActionImpl2(action, options);
        };
        return ActionImpl2;
      })()
    );
    exports.ActionImpl = ActionImpl;
  }
});

// node_modules/kbar/lib/action/ActionInterface.js
var require_ActionInterface = __commonJS({
  "node_modules/kbar/lib/action/ActionInterface.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ActionInterface = void 0;
    var tiny_invariant_1 = __importDefault(require_tiny_invariant_cjs());
    var ActionImpl_1 = require_ActionImpl();
    var ActionInterface = (
      /** @class */
      (function() {
        function ActionInterface2(actions, options) {
          if (actions === void 0) {
            actions = [];
          }
          if (options === void 0) {
            options = {};
          }
          this.actions = {};
          this.options = options;
          this.add(actions);
        }
        ActionInterface2.prototype.add = function(actions) {
          for (var i = 0; i < actions.length; i++) {
            var action = actions[i];
            if (action.parent) {
              (0, tiny_invariant_1.default)(this.actions[action.parent], 'Attempted to create action "' + action.name + '" without registering its parent "' + action.parent + '" first.');
            }
            this.actions[action.id] = ActionImpl_1.ActionImpl.create(action, {
              history: this.options.historyManager,
              store: this.actions
            });
          }
          return __assign({}, this.actions);
        };
        ActionInterface2.prototype.remove = function(actions) {
          var _this = this;
          actions.forEach(function(action) {
            var actionImpl = _this.actions[action.id];
            if (!actionImpl)
              return;
            var children = actionImpl.children;
            while (children.length) {
              var child = children.pop();
              if (!child)
                return;
              delete _this.actions[child.id];
              if (child.parentActionImpl)
                child.parentActionImpl.removeChild(child);
              if (child.children)
                children.push.apply(children, child.children);
            }
            if (actionImpl.parentActionImpl) {
              actionImpl.parentActionImpl.removeChild(actionImpl);
            }
            delete _this.actions[action.id];
          });
          return __assign({}, this.actions);
        };
        return ActionInterface2;
      })()
    );
    exports.ActionInterface = ActionInterface;
  }
});

// node_modules/kbar/lib/action/HistoryImpl.js
var require_HistoryImpl = __commonJS({
  "node_modules/kbar/lib/action/HistoryImpl.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.history = exports.HistoryItemImpl = void 0;
    var utils_1 = require_utils();
    var HistoryItemImpl = (
      /** @class */
      (function() {
        function HistoryItemImpl2(item) {
          this.perform = item.perform;
          this.negate = item.negate;
        }
        HistoryItemImpl2.create = function(item) {
          return new HistoryItemImpl2(item);
        };
        return HistoryItemImpl2;
      })()
    );
    exports.HistoryItemImpl = HistoryItemImpl;
    var HistoryImpl = (
      /** @class */
      (function() {
        function HistoryImpl2() {
          this.undoStack = [];
          this.redoStack = [];
          if (!HistoryImpl2.instance) {
            HistoryImpl2.instance = this;
            this.init();
          }
          return HistoryImpl2.instance;
        }
        HistoryImpl2.prototype.init = function() {
          var _this = this;
          if (typeof window === "undefined")
            return;
          window.addEventListener("keydown", function(event) {
            var _a;
            if (!_this.redoStack.length && !_this.undoStack.length || (0, utils_1.shouldRejectKeystrokes)()) {
              return;
            }
            var key = (_a = event.key) === null || _a === void 0 ? void 0 : _a.toLowerCase();
            if (event.metaKey && key === "z" && event.shiftKey) {
              _this.redo();
            } else if (event.metaKey && key === "z") {
              _this.undo();
            }
          });
        };
        HistoryImpl2.prototype.add = function(item) {
          var historyItem = HistoryItemImpl.create(item);
          this.undoStack.push(historyItem);
          return historyItem;
        };
        HistoryImpl2.prototype.remove = function(item) {
          var undoIndex = this.undoStack.findIndex(function(i) {
            return i === item;
          });
          if (undoIndex !== -1) {
            this.undoStack.splice(undoIndex, 1);
            return;
          }
          var redoIndex = this.redoStack.findIndex(function(i) {
            return i === item;
          });
          if (redoIndex !== -1) {
            this.redoStack.splice(redoIndex, 1);
          }
        };
        HistoryImpl2.prototype.undo = function(item) {
          if (!item) {
            var item_1 = this.undoStack.pop();
            if (!item_1)
              return;
            item_1 === null || item_1 === void 0 ? void 0 : item_1.negate();
            this.redoStack.push(item_1);
            return item_1;
          }
          var index = this.undoStack.findIndex(function(i) {
            return i === item;
          });
          if (index === -1)
            return;
          this.undoStack.splice(index, 1);
          item.negate();
          this.redoStack.push(item);
          return item;
        };
        HistoryImpl2.prototype.redo = function(item) {
          if (!item) {
            var item_2 = this.redoStack.pop();
            if (!item_2)
              return;
            item_2 === null || item_2 === void 0 ? void 0 : item_2.perform();
            this.undoStack.push(item_2);
            return item_2;
          }
          var index = this.redoStack.findIndex(function(i) {
            return i === item;
          });
          if (index === -1)
            return;
          this.redoStack.splice(index, 1);
          item.perform();
          this.undoStack.push(item);
          return item;
        };
        HistoryImpl2.prototype.reset = function() {
          this.undoStack.splice(0);
          this.redoStack.splice(0);
        };
        return HistoryImpl2;
      })()
    );
    var history = new HistoryImpl();
    exports.history = history;
    Object.freeze(history);
  }
});

// node_modules/kbar/lib/types.js
var require_types = __commonJS({
  "node_modules/kbar/lib/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VisualState = void 0;
    var VisualState3;
    (function(VisualState4) {
      VisualState4["animatingIn"] = "animating-in";
      VisualState4["showing"] = "showing";
      VisualState4["animatingOut"] = "animating-out";
      VisualState4["hidden"] = "hidden";
    })(VisualState3 = exports.VisualState || (exports.VisualState = {}));
  }
});

// node_modules/kbar/lib/useStore.js
var require_useStore = __commonJS({
  "node_modules/kbar/lib/useStore.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.useStore = void 0;
    var fast_equals_1 = require_fast_equals();
    var React6 = __importStar(require_react());
    var tiny_invariant_1 = __importDefault(require_tiny_invariant_cjs());
    var ActionInterface_1 = require_ActionInterface();
    var HistoryImpl_1 = require_HistoryImpl();
    var types_1 = require_types();
    function useStore(props2) {
      var optionsRef = React6.useRef(__assign({ animations: {
        enterMs: 200,
        exitMs: 100
      } }, props2.options));
      var actionsInterface = React6.useMemo(
        function() {
          return new ActionInterface_1.ActionInterface(props2.actions || [], {
            historyManager: optionsRef.current.enableHistory ? HistoryImpl_1.history : void 0
          });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
      );
      var _a = React6.useState({
        searchQuery: "",
        currentRootActionId: null,
        visualState: types_1.VisualState.hidden,
        actions: __assign({}, actionsInterface.actions),
        activeIndex: 0
      }), state = _a[0], setState = _a[1];
      var currState = React6.useRef(state);
      currState.current = state;
      var getState = React6.useCallback(function() {
        return currState.current;
      }, []);
      var publisher = React6.useMemo(function() {
        return new Publisher(getState);
      }, [getState]);
      React6.useEffect(function() {
        currState.current = state;
        publisher.notify();
      }, [state, publisher]);
      var registerActions = React6.useCallback(function(actions) {
        setState(function(state2) {
          return __assign(__assign({}, state2), { actions: actionsInterface.add(actions) });
        });
        return function unregister() {
          setState(function(state2) {
            return __assign(__assign({}, state2), { actions: actionsInterface.remove(actions) });
          });
        };
      }, [actionsInterface]);
      var inputRef = React6.useRef(null);
      return React6.useMemo(function() {
        return {
          getState,
          query: {
            setCurrentRootAction: function(actionId) {
              setState(function(state2) {
                return __assign(__assign({}, state2), { currentRootActionId: actionId });
              });
            },
            setVisualState: function(cb) {
              setState(function(state2) {
                return __assign(__assign({}, state2), { visualState: typeof cb === "function" ? cb(state2.visualState) : cb });
              });
            },
            setSearch: function(searchQuery) {
              return setState(function(state2) {
                return __assign(__assign({}, state2), { searchQuery });
              });
            },
            registerActions,
            toggle: function() {
              return setState(function(state2) {
                return __assign(__assign({}, state2), { visualState: [
                  types_1.VisualState.animatingOut,
                  types_1.VisualState.hidden
                ].includes(state2.visualState) ? types_1.VisualState.animatingIn : types_1.VisualState.animatingOut });
              });
            },
            setActiveIndex: function(cb) {
              return setState(function(state2) {
                return __assign(__assign({}, state2), { activeIndex: typeof cb === "number" ? cb : cb(state2.activeIndex) });
              });
            },
            inputRefSetter: function(el) {
              inputRef.current = el;
            },
            getInput: function() {
              (0, tiny_invariant_1.default)(inputRef.current, "Input is undefined, make sure you apple `query.inputRefSetter` to your search input.");
              return inputRef.current;
            }
          },
          options: optionsRef.current,
          subscribe: function(collector, cb) {
            return publisher.subscribe(collector, cb);
          }
        };
      }, [getState, publisher, registerActions]);
    }
    exports.useStore = useStore;
    var Publisher = (
      /** @class */
      (function() {
        function Publisher2(getState) {
          this.subscribers = [];
          this.getState = getState;
        }
        Publisher2.prototype.subscribe = function(collector, onChange) {
          var _this = this;
          var subscriber = new Subscriber(function() {
            return collector(_this.getState());
          }, onChange);
          this.subscribers.push(subscriber);
          return this.unsubscribe.bind(this, subscriber);
        };
        Publisher2.prototype.unsubscribe = function(subscriber) {
          if (this.subscribers.length) {
            var index = this.subscribers.indexOf(subscriber);
            if (index > -1) {
              return this.subscribers.splice(index, 1);
            }
          }
        };
        Publisher2.prototype.notify = function() {
          this.subscribers.forEach(function(subscriber) {
            return subscriber.collect();
          });
        };
        return Publisher2;
      })()
    );
    var Subscriber = (
      /** @class */
      (function() {
        function Subscriber2(collector, onChange) {
          this.collector = collector;
          this.onChange = onChange;
        }
        Subscriber2.prototype.collect = function() {
          try {
            var recollect = this.collector();
            if (!(0, fast_equals_1.deepEqual)(recollect, this.collected)) {
              this.collected = recollect;
              if (this.onChange) {
                this.onChange(this.collected);
              }
            }
          } catch (error) {
            console.warn(error);
          }
        };
        return Subscriber2;
      })()
    );
  }
});

// node_modules/kbar/lib/tinykeys.js
var require_tinykeys = __commonJS({
  "node_modules/kbar/lib/tinykeys.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var KEYBINDING_MODIFIER_KEYS = ["Shift", "Meta", "Alt", "Control"];
    var DEFAULT_TIMEOUT = 1e3;
    var DEFAULT_EVENT = "keydown";
    var MOD = typeof navigator === "object" && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control";
    function getModifierState(event, mod) {
      return typeof event.getModifierState === "function" ? event.getModifierState(mod) : false;
    }
    function parse(str) {
      return str.trim().split(" ").map(function(press) {
        var mods = press.split(/\b\+/);
        var key = mods.pop();
        mods = mods.map(function(mod) {
          return mod === "$mod" ? MOD : mod;
        });
        return [mods, key];
      });
    }
    function match(event, press) {
      if (/^[^A-Za-z0-9]$/.test(event.key) && press[1] === event.key) {
        return true;
      }
      return !// Allow either the `event.key` or the `event.code`
      // MDN event.key: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
      // MDN event.code: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
      (press[1].toUpperCase() !== event.key.toUpperCase() && press[1] !== event.code || // Ensure all the modifiers in the keybinding are pressed.
      press[0].find(function(mod) {
        return !getModifierState(event, mod);
      }) || // KEYBINDING_MODIFIER_KEYS (Shift/Control/etc) change the meaning of a
      // keybinding. So if they are pressed but aren't part of the current
      // keybinding press, then we don't have a match.
      KEYBINDING_MODIFIER_KEYS.find(function(mod) {
        return !press[0].includes(mod) && press[1] !== mod && getModifierState(event, mod);
      }));
    }
    function keybindings(target, keyBindingMap, options) {
      var _a, _b;
      if (options === void 0) {
        options = {};
      }
      var timeout = (_a = options.timeout) !== null && _a !== void 0 ? _a : DEFAULT_TIMEOUT;
      var event = (_b = options.event) !== null && _b !== void 0 ? _b : DEFAULT_EVENT;
      var keyBindings = Object.keys(keyBindingMap).map(function(key) {
        return [parse(key), keyBindingMap[key]];
      });
      var possibleMatches = /* @__PURE__ */ new Map();
      var timer = null;
      var onKeyEvent = function(event2) {
        if (!(event2 instanceof KeyboardEvent)) {
          return;
        }
        keyBindings.forEach(function(keyBinding) {
          var sequence = keyBinding[0];
          var callback = keyBinding[1];
          var prev = possibleMatches.get(sequence);
          var remainingExpectedPresses = prev ? prev : sequence;
          var currentExpectedPress = remainingExpectedPresses[0];
          var matches = match(event2, currentExpectedPress);
          if (!matches) {
            if (!getModifierState(event2, event2.key)) {
              possibleMatches.delete(sequence);
            }
          } else if (remainingExpectedPresses.length > 1) {
            possibleMatches.set(sequence, remainingExpectedPresses.slice(1));
          } else {
            possibleMatches.delete(sequence);
            callback(event2);
          }
        });
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(possibleMatches.clear.bind(possibleMatches), timeout);
      };
      target.addEventListener(event, onKeyEvent);
      return function() {
        target.removeEventListener(event, onKeyEvent);
      };
    }
    exports.default = keybindings;
  }
});

// node_modules/kbar/lib/InternalEvents.js
var require_InternalEvents = __commonJS({
  "node_modules/kbar/lib/InternalEvents.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.InternalEvents = void 0;
    var React6 = __importStar(require_react());
    var tinykeys_1 = __importDefault(require_tinykeys());
    var types_1 = require_types();
    var useKBar_1 = require_useKBar();
    var utils_1 = require_utils();
    function InternalEvents() {
      useToggleHandler();
      useDocumentLock();
      useShortcuts();
      useFocusHandler();
      return null;
    }
    exports.InternalEvents = InternalEvents;
    function useToggleHandler() {
      var _a, _b;
      var _c = (0, useKBar_1.useKBar)(function(state) {
        return {
          visualState: state.visualState,
          showing: state.visualState !== types_1.VisualState.hidden
        };
      }), query = _c.query, options = _c.options, visualState = _c.visualState, showing = _c.showing;
      React6.useEffect(function() {
        var _a2;
        var shortcut = options.toggleShortcut || "$mod+k";
        var unsubscribe = (0, tinykeys_1.default)(window, (_a2 = {}, _a2[shortcut] = function(event) {
          var _a3, _b2, _c2, _d;
          if (event.defaultPrevented)
            return;
          event.preventDefault();
          query.toggle();
          if (showing) {
            (_b2 = (_a3 = options.callbacks) === null || _a3 === void 0 ? void 0 : _a3.onClose) === null || _b2 === void 0 ? void 0 : _b2.call(_a3);
          } else {
            (_d = (_c2 = options.callbacks) === null || _c2 === void 0 ? void 0 : _c2.onOpen) === null || _d === void 0 ? void 0 : _d.call(_c2);
          }
        }, _a2.Escape = function(event) {
          var _a3, _b2;
          if (showing) {
            event.stopPropagation();
            event.preventDefault();
            (_b2 = (_a3 = options.callbacks) === null || _a3 === void 0 ? void 0 : _a3.onClose) === null || _b2 === void 0 ? void 0 : _b2.call(_a3);
          }
          query.setVisualState(function(vs) {
            if (vs === types_1.VisualState.hidden || vs === types_1.VisualState.animatingOut) {
              return vs;
            }
            return types_1.VisualState.animatingOut;
          });
        }, _a2));
        return function() {
          unsubscribe();
        };
      }, [options.callbacks, options.toggleShortcut, query, showing]);
      var timeoutRef = React6.useRef();
      var runAnimateTimer = React6.useCallback(function(vs) {
        var _a2, _b2;
        var ms = 0;
        if (vs === types_1.VisualState.animatingIn) {
          ms = ((_a2 = options.animations) === null || _a2 === void 0 ? void 0 : _a2.enterMs) || 0;
        }
        if (vs === types_1.VisualState.animatingOut) {
          ms = ((_b2 = options.animations) === null || _b2 === void 0 ? void 0 : _b2.exitMs) || 0;
        }
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(function() {
          var backToRoot = false;
          query.setVisualState(function() {
            var finalVs = vs === types_1.VisualState.animatingIn ? types_1.VisualState.showing : types_1.VisualState.hidden;
            if (finalVs === types_1.VisualState.hidden) {
              backToRoot = true;
            }
            return finalVs;
          });
          if (backToRoot) {
            query.setCurrentRootAction(null);
          }
        }, ms);
      }, [(_a = options.animations) === null || _a === void 0 ? void 0 : _a.enterMs, (_b = options.animations) === null || _b === void 0 ? void 0 : _b.exitMs, query]);
      React6.useEffect(function() {
        switch (visualState) {
          case types_1.VisualState.animatingIn:
          case types_1.VisualState.animatingOut:
            runAnimateTimer(visualState);
            break;
        }
      }, [runAnimateTimer, visualState]);
    }
    function useDocumentLock() {
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          visualState: state.visualState
        };
      }), visualState = _a.visualState, options = _a.options;
      React6.useEffect(function() {
        if (options.disableDocumentLock)
          return;
        if (visualState === types_1.VisualState.animatingIn) {
          document.body.style.overflow = "hidden";
          if (!options.disableScrollbarManagement) {
            var scrollbarWidth = (0, utils_1.getScrollbarWidth)();
            var mr = getComputedStyle(document.body)["margin-right"];
            if (mr) {
              scrollbarWidth += Number(mr.replace(/\D/g, ""));
            }
            document.body.style.marginRight = scrollbarWidth + "px";
          }
        } else if (visualState === types_1.VisualState.hidden) {
          document.body.style.removeProperty("overflow");
          if (!options.disableScrollbarManagement) {
            document.body.style.removeProperty("margin-right");
          }
        }
      }, [
        options.disableDocumentLock,
        options.disableScrollbarManagement,
        visualState
      ]);
    }
    var handled = /* @__PURE__ */ new WeakSet();
    function wrap(handler) {
      return function(event) {
        if (handled.has(event))
          return;
        handler(event);
        handled.add(event);
      };
    }
    function useShortcuts() {
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          actions: state.actions,
          open: state.visualState === types_1.VisualState.showing
        };
      }), actions = _a.actions, query = _a.query, open = _a.open, options = _a.options;
      React6.useEffect(function() {
        var _a2;
        if (open)
          return;
        var actionsList = Object.keys(actions).map(function(key) {
          return actions[key];
        });
        var actionsWithShortcuts = [];
        for (var _i = 0, actionsList_1 = actionsList; _i < actionsList_1.length; _i++) {
          var action = actionsList_1[_i];
          if (!((_a2 = action.shortcut) === null || _a2 === void 0 ? void 0 : _a2.length)) {
            continue;
          }
          actionsWithShortcuts.push(action);
        }
        actionsWithShortcuts = actionsWithShortcuts.sort(function(a, b) {
          return b.shortcut.join(" ").length - a.shortcut.join(" ").length;
        });
        var shortcutsMap = {};
        var _loop_1 = function(action2) {
          var shortcut = action2.shortcut.join(" ");
          shortcutsMap[shortcut] = wrap(function(event) {
            var _a3, _b2, _c, _d, _e, _f;
            if ((0, utils_1.shouldRejectKeystrokes)())
              return;
            event.preventDefault();
            if ((_a3 = action2.children) === null || _a3 === void 0 ? void 0 : _a3.length) {
              query.setCurrentRootAction(action2.id);
              query.toggle();
              (_c = (_b2 = options.callbacks) === null || _b2 === void 0 ? void 0 : _b2.onOpen) === null || _c === void 0 ? void 0 : _c.call(_b2);
            } else {
              (_d = action2.command) === null || _d === void 0 ? void 0 : _d.perform();
              (_f = (_e = options.callbacks) === null || _e === void 0 ? void 0 : _e.onSelectAction) === null || _f === void 0 ? void 0 : _f.call(_e, action2);
            }
          });
        };
        for (var _b = 0, actionsWithShortcuts_1 = actionsWithShortcuts; _b < actionsWithShortcuts_1.length; _b++) {
          var action = actionsWithShortcuts_1[_b];
          _loop_1(action);
        }
        var unsubscribe = (0, tinykeys_1.default)(window, shortcutsMap, {
          timeout: 400
        });
        return function() {
          unsubscribe();
        };
      }, [actions, open, options.callbacks, query]);
    }
    function useFocusHandler() {
      var rFirstRender = React6.useRef(true);
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          isShowing: state.visualState === types_1.VisualState.showing || state.visualState === types_1.VisualState.animatingIn
        };
      }), isShowing = _a.isShowing, query = _a.query;
      var activeElementRef = React6.useRef(null);
      React6.useEffect(function() {
        if (rFirstRender.current) {
          rFirstRender.current = false;
          return;
        }
        if (isShowing) {
          activeElementRef.current = document.activeElement;
          return;
        }
        var currentActiveElement = document.activeElement;
        if ((currentActiveElement === null || currentActiveElement === void 0 ? void 0 : currentActiveElement.tagName.toLowerCase()) === "input") {
          currentActiveElement.blur();
        }
        var activeElement = activeElementRef.current;
        if (activeElement && activeElement !== currentActiveElement) {
          activeElement.focus();
        }
      }, [isShowing]);
      React6.useEffect(function() {
        function handler(event) {
          var input = query.getInput();
          if (event.target !== input) {
            input.focus();
          }
        }
        if (isShowing) {
          window.addEventListener("keydown", handler);
          return function() {
            window.removeEventListener("keydown", handler);
          };
        }
      }, [isShowing, query]);
    }
  }
});

// node_modules/kbar/lib/KBarContextProvider.js
var require_KBarContextProvider = __commonJS({
  "node_modules/kbar/lib/KBarContextProvider.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarProvider = exports.KBarContext = void 0;
    var useStore_1 = require_useStore();
    var React6 = __importStar(require_react());
    var InternalEvents_1 = require_InternalEvents();
    exports.KBarContext = React6.createContext({});
    var KBarProvider3 = function(props2) {
      var contextValue = (0, useStore_1.useStore)(props2);
      return React6.createElement(
        exports.KBarContext.Provider,
        { value: contextValue },
        React6.createElement(InternalEvents_1.InternalEvents, null),
        props2.children
      );
    };
    exports.KBarProvider = KBarProvider3;
  }
});

// node_modules/kbar/lib/useKBar.js
var require_useKBar = __commonJS({
  "node_modules/kbar/lib/useKBar.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.useKBar = void 0;
    var React6 = __importStar(require_react());
    var KBarContextProvider_1 = require_KBarContextProvider();
    function useKBar2(collector) {
      var _a = React6.useContext(KBarContextProvider_1.KBarContext), query = _a.query, getState = _a.getState, subscribe = _a.subscribe, options = _a.options;
      var collected = React6.useRef(collector === null || collector === void 0 ? void 0 : collector(getState()));
      var collectorRef = React6.useRef(collector);
      var onCollect = React6.useCallback(function(collected2) {
        return __assign(__assign({}, collected2), { query, options });
      }, [query, options]);
      var _b = React6.useState(onCollect(collected.current)), render = _b[0], setRender = _b[1];
      React6.useEffect(function() {
        var unsubscribe;
        if (collectorRef.current) {
          unsubscribe = subscribe(function(current) {
            return collectorRef.current(current);
          }, function(collected2) {
            return setRender(onCollect(collected2));
          });
        }
        return function() {
          if (unsubscribe) {
            unsubscribe();
          }
        };
      }, [onCollect, subscribe]);
      return render;
    }
    exports.useKBar = useKBar2;
  }
});

// node_modules/command-score/index.js
var require_command_score = __commonJS({
  "node_modules/command-score/index.js"(exports, module) {
    var SCORE_CONTINUE_MATCH = 1;
    var SCORE_WORD_JUMP = 0.9;
    var SCORE_CHARACTER_JUMP = 0.3;
    var SCORE_TRANSPOSITION = 0.1;
    var SCORE_LONG_JUMP = 0;
    var PENALTY_SKIPPED = 0.999;
    var PENALTY_CASE_MISMATCH = 0.9999;
    var PENALTY_NOT_COMPLETE = 0.99;
    var IS_GAP_REGEXP = /[\\\/\-_+.# \t"@\[\(\{&]/;
    var COUNT_GAPS_REGEXP = /[\\\/\-_+.# \t"@\[\(\{&]/g;
    function commandScoreInner(string, abbreviation, lowerString, lowerAbbreviation, stringIndex, abbreviationIndex) {
      if (abbreviationIndex === abbreviation.length) {
        if (stringIndex === string.length) {
          return SCORE_CONTINUE_MATCH;
        }
        return PENALTY_NOT_COMPLETE;
      }
      var abbreviationChar = lowerAbbreviation.charAt(abbreviationIndex);
      var index = lowerString.indexOf(abbreviationChar, stringIndex);
      var highScore = 0;
      var score, transposedScore, wordBreaks;
      while (index >= 0) {
        score = commandScoreInner(string, abbreviation, lowerString, lowerAbbreviation, index + 1, abbreviationIndex + 1);
        if (score > highScore) {
          if (index === stringIndex) {
            score *= SCORE_CONTINUE_MATCH;
          } else if (IS_GAP_REGEXP.test(string.charAt(index - 1))) {
            score *= SCORE_WORD_JUMP;
            wordBreaks = string.slice(stringIndex, index - 1).match(COUNT_GAPS_REGEXP);
            if (wordBreaks && stringIndex > 0) {
              score *= Math.pow(PENALTY_SKIPPED, wordBreaks.length);
            }
          } else if (IS_GAP_REGEXP.test(string.slice(stringIndex, index - 1))) {
            score *= SCORE_LONG_JUMP;
            if (stringIndex > 0) {
              score *= Math.pow(PENALTY_SKIPPED, index - stringIndex);
            }
          } else {
            score *= SCORE_CHARACTER_JUMP;
            if (stringIndex > 0) {
              score *= Math.pow(PENALTY_SKIPPED, index - stringIndex);
            }
          }
          if (string.charAt(index) !== abbreviation.charAt(abbreviationIndex)) {
            score *= PENALTY_CASE_MISMATCH;
          }
        }
        if (score < SCORE_TRANSPOSITION && lowerString.charAt(index - 1) === lowerAbbreviation.charAt(abbreviationIndex + 1) && lowerString.charAt(index - 1) !== lowerAbbreviation.charAt(abbreviationIndex)) {
          transposedScore = commandScoreInner(string, abbreviation, lowerString, lowerAbbreviation, index + 1, abbreviationIndex + 2);
          if (transposedScore * SCORE_TRANSPOSITION > score) {
            score = transposedScore * SCORE_TRANSPOSITION;
          }
        }
        if (score > highScore) {
          highScore = score;
        }
        index = lowerString.indexOf(abbreviationChar, index + 1);
      }
      return highScore;
    }
    function commandScore(string, abbreviation) {
      return commandScoreInner(string, abbreviation, string.toLowerCase(), abbreviation.toLowerCase(), 0, 0);
    }
    module.exports = commandScore;
  }
});

// node_modules/kbar/lib/useMatches.js
var require_useMatches = __commonJS({
  "node_modules/kbar/lib/useMatches.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.useDeepMatches = exports.useMatches = exports.NO_GROUP = void 0;
    var React6 = __importStar(require_react());
    var useKBar_1 = require_useKBar();
    var utils_1 = require_utils();
    var command_score_1 = __importDefault(require_command_score());
    exports.NO_GROUP = {
      name: "none",
      priority: utils_1.Priority.NORMAL
    };
    function order(a, b) {
      return b.priority - a.priority;
    }
    function useMatches3() {
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          search: state.searchQuery,
          actions: state.actions,
          rootActionId: state.currentRootActionId
        };
      }), search = _a.search, actions = _a.actions, rootActionId = _a.rootActionId;
      var rootResults = React6.useMemo(function() {
        return Object.keys(actions).reduce(function(acc, actionId) {
          var action = actions[actionId];
          if (!action.parent && !rootActionId) {
            acc.push(action);
          }
          if (action.id === rootActionId) {
            for (var i = 0; i < action.children.length; i++) {
              acc.push(action.children[i]);
            }
          }
          return acc;
        }, []).sort(order);
      }, [actions, rootActionId]);
      var getDeepResults = React6.useCallback(function(actions2) {
        var actionsClone = [];
        for (var i = 0; i < actions2.length; i++) {
          actionsClone.push(actions2[i]);
        }
        return (function collectChildren(actions3, all) {
          if (all === void 0) {
            all = actionsClone;
          }
          for (var i2 = 0; i2 < actions3.length; i2++) {
            if (actions3[i2].children.length > 0) {
              var childsChildren = actions3[i2].children;
              for (var i_1 = 0; i_1 < childsChildren.length; i_1++) {
                all.push(childsChildren[i_1]);
              }
              collectChildren(actions3[i2].children, all);
            }
          }
          return all;
        })(actions2);
      }, []);
      var emptySearch = !search;
      var filtered = React6.useMemo(function() {
        if (emptySearch)
          return rootResults;
        return getDeepResults(rootResults);
      }, [getDeepResults, rootResults, emptySearch]);
      var matches = useInternalMatches(filtered, search);
      var results = React6.useMemo(function() {
        var _a2, _b;
        var map = {};
        var list = [];
        var ordered = [];
        for (var i = 0; i < matches.length; i++) {
          var match = matches[i];
          var action = match.action;
          var score = match.score || utils_1.Priority.NORMAL;
          var section = {
            name: typeof action.section === "string" ? action.section : ((_a2 = action.section) === null || _a2 === void 0 ? void 0 : _a2.name) || exports.NO_GROUP.name,
            priority: typeof action.section === "string" ? score : ((_b = action.section) === null || _b === void 0 ? void 0 : _b.priority) || 0 + score
          };
          if (!map[section.name]) {
            map[section.name] = [];
            list.push(section);
          }
          map[section.name].push({
            priority: action.priority + score,
            action
          });
        }
        ordered = list.sort(order).map(function(group2) {
          return {
            name: group2.name,
            actions: map[group2.name].sort(order).map(function(item) {
              return item.action;
            })
          };
        });
        var results2 = [];
        for (var i = 0; i < ordered.length; i++) {
          var group = ordered[i];
          if (group.name !== exports.NO_GROUP.name)
            results2.push(group.name);
          for (var i_2 = 0; i_2 < group.actions.length; i_2++) {
            results2.push(group.actions[i_2]);
          }
        }
        return results2;
      }, [matches]);
      var memoRootActionId = React6.useMemo(function() {
        return rootActionId;
      }, [results]);
      return React6.useMemo(function() {
        return {
          results,
          rootActionId: memoRootActionId
        };
      }, [memoRootActionId, results]);
    }
    exports.useMatches = useMatches3;
    function useInternalMatches(filtered, search) {
      var value = React6.useMemo(function() {
        return {
          filtered,
          search
        };
      }, [filtered, search]);
      var _a = (0, utils_1.useThrottledValue)(value), throttledFiltered = _a.filtered, throttledSearch = _a.search;
      return React6.useMemo(function() {
        if (throttledSearch.trim() === "") {
          return throttledFiltered.map(function(action2) {
            return { score: 0, action: action2 };
          });
        }
        var matches = [];
        for (var i = 0; i < throttledFiltered.length; i++) {
          var action = throttledFiltered[i];
          var score = (0, command_score_1.default)([action.name, action.keywords, action.subtitle].join(" "), throttledSearch);
          if (score > 0) {
            matches.push({ score, action });
          }
        }
        return matches;
      }, [throttledFiltered, throttledSearch]);
    }
    exports.useDeepMatches = useMatches3;
  }
});

// node_modules/@radix-ui/react-compose-refs/dist/index.js
var require_dist = __commonJS({
  "node_modules/@radix-ui/react-compose-refs/dist/index.js"(exports, module) {
    "use strict";
    var __create = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS2 = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export2(index_exports, {
      composeRefs: () => composeRefs,
      useComposedRefs: () => useComposedRefs
    });
    module.exports = __toCommonJS2(index_exports);
    var React6 = __toESM2(require_react());
    function setRef(ref, value) {
      if (typeof ref === "function") {
        return ref(value);
      } else if (ref !== null && ref !== void 0) {
        ref.current = value;
      }
    }
    function composeRefs(...refs) {
      return (node) => {
        let hasCleanup = false;
        const cleanups = refs.map((ref) => {
          const cleanup = setRef(ref, node);
          if (!hasCleanup && typeof cleanup == "function") {
            hasCleanup = true;
          }
          return cleanup;
        });
        if (hasCleanup) {
          return () => {
            for (let i = 0; i < cleanups.length; i++) {
              const cleanup = cleanups[i];
              if (typeof cleanup == "function") {
                cleanup();
              } else {
                setRef(refs[i], null);
              }
            }
          };
        }
      };
    }
    function useComposedRefs(...refs) {
      return React6.useCallback(composeRefs(...refs), refs);
    }
  }
});

// node_modules/@radix-ui/react-primitive/node_modules/@radix-ui/react-slot/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/@radix-ui/react-primitive/node_modules/@radix-ui/react-slot/dist/index.js"(exports, module) {
    "use strict";
    var __create = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS2 = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export2(index_exports, {
      Root: () => Slot,
      Slot: () => Slot,
      Slottable: () => Slottable,
      createSlot: () => createSlot,
      createSlottable: () => createSlottable
    });
    module.exports = __toCommonJS2(index_exports);
    var React6 = __toESM2(require_react());
    var import_react_compose_refs = require_dist();
    var import_jsx_runtime = require_jsx_runtime();
    function createSlot(ownerName) {
      const SlotClone = createSlotClone(ownerName);
      const Slot2 = React6.forwardRef((props2, forwardedRef) => {
        const { children, ...slotProps } = props2;
        const childrenArray = React6.Children.toArray(children);
        const slottable = childrenArray.find(isSlottable);
        if (slottable) {
          const newElement = slottable.props.children;
          const newChildren = childrenArray.map((child) => {
            if (child === slottable) {
              if (React6.Children.count(newElement) > 1) return React6.Children.only(null);
              return React6.isValidElement(newElement) ? newElement.props.children : null;
            } else {
              return child;
            }
          });
          return (0, import_jsx_runtime.jsx)(SlotClone, { ...slotProps, ref: forwardedRef, children: React6.isValidElement(newElement) ? React6.cloneElement(newElement, void 0, newChildren) : null });
        }
        return (0, import_jsx_runtime.jsx)(SlotClone, { ...slotProps, ref: forwardedRef, children });
      });
      Slot2.displayName = `${ownerName}.Slot`;
      return Slot2;
    }
    var Slot = createSlot("Slot");
    function createSlotClone(ownerName) {
      const SlotClone = React6.forwardRef((props2, forwardedRef) => {
        const { children, ...slotProps } = props2;
        if (React6.isValidElement(children)) {
          const childrenRef = getElementRef(children);
          const props22 = mergeProps(slotProps, children.props);
          if (children.type !== React6.Fragment) {
            props22.ref = forwardedRef ? (0, import_react_compose_refs.composeRefs)(forwardedRef, childrenRef) : childrenRef;
          }
          return React6.cloneElement(children, props22);
        }
        return React6.Children.count(children) > 1 ? React6.Children.only(null) : null;
      });
      SlotClone.displayName = `${ownerName}.SlotClone`;
      return SlotClone;
    }
    var SLOTTABLE_IDENTIFIER = Symbol("radix.slottable");
    function createSlottable(ownerName) {
      const Slottable2 = ({ children }) => {
        return (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
      };
      Slottable2.displayName = `${ownerName}.Slottable`;
      Slottable2.__radixId = SLOTTABLE_IDENTIFIER;
      return Slottable2;
    }
    var Slottable = createSlottable("Slottable");
    function isSlottable(child) {
      return React6.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER;
    }
    function mergeProps(slotProps, childProps) {
      const overrideProps = { ...childProps };
      for (const propName in childProps) {
        const slotPropValue = slotProps[propName];
        const childPropValue = childProps[propName];
        const isHandler = /^on[A-Z]/.test(propName);
        if (isHandler) {
          if (slotPropValue && childPropValue) {
            overrideProps[propName] = (...args) => {
              const result = childPropValue(...args);
              slotPropValue(...args);
              return result;
            };
          } else if (slotPropValue) {
            overrideProps[propName] = slotPropValue;
          }
        } else if (propName === "style") {
          overrideProps[propName] = { ...slotPropValue, ...childPropValue };
        } else if (propName === "className") {
          overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
        }
      }
      return { ...slotProps, ...overrideProps };
    }
    function getElementRef(element) {
      var _a, _b;
      let getter = (_a = Object.getOwnPropertyDescriptor(element.props, "ref")) == null ? void 0 : _a.get;
      let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
      if (mayWarn) {
        return element.ref;
      }
      getter = (_b = Object.getOwnPropertyDescriptor(element, "ref")) == null ? void 0 : _b.get;
      mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
      if (mayWarn) {
        return element.props.ref;
      }
      return element.props.ref || element.ref;
    }
  }
});

// node_modules/@radix-ui/react-primitive/dist/index.js
var require_dist3 = __commonJS({
  "node_modules/@radix-ui/react-primitive/dist/index.js"(exports, module) {
    "use strict";
    var __create = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS2 = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export2(index_exports, {
      Primitive: () => Primitive,
      Root: () => Root,
      dispatchDiscreteCustomEvent: () => dispatchDiscreteCustomEvent
    });
    module.exports = __toCommonJS2(index_exports);
    var React6 = __toESM2(require_react());
    var ReactDOM = __toESM2(require_react_dom());
    var import_react_slot = require_dist2();
    var import_jsx_runtime = require_jsx_runtime();
    var NODES = [
      "a",
      "button",
      "div",
      "form",
      "h2",
      "h3",
      "img",
      "input",
      "label",
      "li",
      "nav",
      "ol",
      "p",
      "select",
      "span",
      "svg",
      "ul"
    ];
    var Primitive = NODES.reduce((primitive, node) => {
      const Slot = (0, import_react_slot.createSlot)(`Primitive.${node}`);
      const Node = React6.forwardRef((props2, forwardedRef) => {
        const { asChild, ...primitiveProps } = props2;
        const Comp = asChild ? Slot : node;
        if (typeof window !== "undefined") {
          window[Symbol.for("radix-ui")] = true;
        }
        return (0, import_jsx_runtime.jsx)(Comp, { ...primitiveProps, ref: forwardedRef });
      });
      Node.displayName = `Primitive.${node}`;
      return { ...primitive, [node]: Node };
    }, {});
    function dispatchDiscreteCustomEvent(target, event) {
      if (target) ReactDOM.flushSync(() => target.dispatchEvent(event));
    }
    var Root = Primitive;
  }
});

// node_modules/@radix-ui/react-use-layout-effect/dist/index.js
var require_dist4 = __commonJS({
  "node_modules/@radix-ui/react-use-layout-effect/dist/index.js"(exports, module) {
    "use strict";
    var __create = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS2 = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export2(index_exports, {
      useLayoutEffect: () => useLayoutEffect2
    });
    module.exports = __toCommonJS2(index_exports);
    var React6 = __toESM2(require_react());
    var useLayoutEffect2 = (globalThis == null ? void 0 : globalThis.document) ? React6.useLayoutEffect : () => {
    };
  }
});

// node_modules/@radix-ui/react-portal/dist/index.js
var require_dist5 = __commonJS({
  "node_modules/@radix-ui/react-portal/dist/index.js"(exports, module) {
    "use strict";
    "use client";
    var __create = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS2 = (mod) => __copyProps(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export2(index_exports, {
      Portal: () => Portal,
      Root: () => Root
    });
    module.exports = __toCommonJS2(index_exports);
    var React6 = __toESM2(require_react());
    var import_react_dom = __toESM2(require_react_dom());
    var import_react_primitive = require_dist3();
    var import_react_use_layout_effect = require_dist4();
    var import_jsx_runtime = require_jsx_runtime();
    var PORTAL_NAME = "Portal";
    var Portal = React6.forwardRef((props2, forwardedRef) => {
      var _a;
      const { container: containerProp, ...portalProps } = props2;
      const [mounted, setMounted] = React6.useState(false);
      (0, import_react_use_layout_effect.useLayoutEffect)(() => setMounted(true), []);
      const container = containerProp || mounted && ((_a = globalThis == null ? void 0 : globalThis.document) == null ? void 0 : _a.body);
      return container ? import_react_dom.default.createPortal((0, import_jsx_runtime.jsx)(import_react_primitive.Primitive.div, { ...portalProps, ref: forwardedRef }), container) : null;
    });
    Portal.displayName = PORTAL_NAME;
    var Root = Portal;
  }
});

// node_modules/kbar/lib/KBarPortal.js
var require_KBarPortal = __commonJS({
  "node_modules/kbar/lib/KBarPortal.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarPortal = void 0;
    var react_portal_1 = require_dist5();
    var React6 = __importStar(require_react());
    var types_1 = require_types();
    var useKBar_1 = require_useKBar();
    function KBarPortal3(props2) {
      var showing = (0, useKBar_1.useKBar)(function(state) {
        return {
          showing: state.visualState !== types_1.VisualState.hidden
        };
      }).showing;
      if (!showing) {
        return null;
      }
      return React6.createElement(react_portal_1.Portal, null, props2.children);
    }
    exports.KBarPortal = KBarPortal3;
  }
});

// node_modules/kbar/lib/KBarPositioner.js
var require_KBarPositioner = __commonJS({
  "node_modules/kbar/lib/KBarPositioner.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __rest = exports && exports.__rest || function(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
          if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
            t[p[i]] = s[p[i]];
        }
      return t;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarPositioner = void 0;
    var React6 = __importStar(require_react());
    var defaultStyle = {
      position: "fixed",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      width: "100%",
      inset: "0px",
      padding: "14vh 16px 16px"
    };
    function getStyle(style) {
      return style ? __assign(__assign({}, defaultStyle), style) : defaultStyle;
    }
    exports.KBarPositioner = React6.forwardRef(function(_a, ref) {
      var style = _a.style, children = _a.children, props2 = __rest(_a, ["style", "children"]);
      return React6.createElement("div", __assign({ ref, style: getStyle(style) }, props2), children);
    });
  }
});

// node_modules/kbar/lib/KBarSearch.js
var require_KBarSearch = __commonJS({
  "node_modules/kbar/lib/KBarSearch.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __rest = exports && exports.__rest || function(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
          if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
            t[p[i]] = s[p[i]];
        }
      return t;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarSearch = exports.getListboxItemId = exports.KBAR_LISTBOX = void 0;
    var React6 = __importStar(require_react());
    var types_1 = require_types();
    var useKBar_1 = require_useKBar();
    exports.KBAR_LISTBOX = "kbar-listbox";
    var getListboxItemId2 = function(id) {
      return "kbar-listbox-item-" + id;
    };
    exports.getListboxItemId = getListboxItemId2;
    function KBarSearch3(props2) {
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          search: state.searchQuery,
          currentRootActionId: state.currentRootActionId,
          actions: state.actions,
          activeIndex: state.activeIndex,
          showing: state.visualState === types_1.VisualState.showing
        };
      }), query = _a.query, search = _a.search, actions = _a.actions, currentRootActionId = _a.currentRootActionId, activeIndex = _a.activeIndex, showing = _a.showing, options = _a.options;
      var defaultPlaceholder = props2.defaultPlaceholder, rest = __rest(props2, ["defaultPlaceholder"]);
      React6.useEffect(function() {
        query.setSearch("");
        query.getInput().focus();
        return function() {
          return query.setSearch("");
        };
      }, [currentRootActionId, query]);
      var placeholder = React6.useMemo(function() {
        var defaultText = defaultPlaceholder !== null && defaultPlaceholder !== void 0 ? defaultPlaceholder : "Type a command or search…";
        return currentRootActionId && actions[currentRootActionId] ? actions[currentRootActionId].name : defaultText;
      }, [actions, currentRootActionId, defaultPlaceholder]);
      return React6.createElement("input", __assign({}, rest, { ref: query.inputRefSetter, autoFocus: true, autoComplete: "off", role: "combobox", spellCheck: "false", "aria-expanded": showing, "aria-controls": exports.KBAR_LISTBOX, "aria-activedescendant": (0, exports.getListboxItemId)(activeIndex), value: search, placeholder, onChange: function(event) {
        var _a2, _b, _c;
        (_a2 = props2.onChange) === null || _a2 === void 0 ? void 0 : _a2.call(props2, event);
        query.setSearch(event.target.value);
        (_c = (_b = options === null || options === void 0 ? void 0 : options.callbacks) === null || _b === void 0 ? void 0 : _b.onQueryChange) === null || _c === void 0 ? void 0 : _c.call(_b, event.target.value);
      }, onKeyDown: function(event) {
        var _a2;
        (_a2 = props2.onKeyDown) === null || _a2 === void 0 ? void 0 : _a2.call(props2, event);
        if (currentRootActionId && !search && event.key === "Backspace") {
          var parent_1 = actions[currentRootActionId].parent;
          query.setCurrentRootAction(parent_1);
        }
      } }));
    }
    exports.KBarSearch = KBarSearch3;
  }
});

// node_modules/react-virtual/dist/react-virtual.mjs
var react_virtual_exports = {};
__export(react_virtual_exports, {
  defaultRangeExtractor: () => defaultRangeExtractor,
  useVirtual: () => useVirtual
});
function _extends() {
  _extends = Object.assign || function(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
  return _extends.apply(this, arguments);
}
function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;
  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
}
function observeRect(node, cb) {
  return {
    observe: function observe() {
      var wasEmpty = observedNodes.size === 0;
      if (observedNodes.has(node)) {
        observedNodes.get(node).callbacks.push(cb);
      } else {
        observedNodes.set(node, {
          rect: void 0,
          hasRectChanged: false,
          callbacks: [cb]
        });
      }
      if (wasEmpty) run();
    },
    unobserve: function unobserve() {
      var state = observedNodes.get(node);
      if (state) {
        var index = state.callbacks.indexOf(cb);
        if (index >= 0) state.callbacks.splice(index, 1);
        if (!state.callbacks.length) observedNodes["delete"](node);
        if (!observedNodes.size) cancelAnimationFrame(rafId);
      }
    }
  };
}
function useRect(nodeRef, initialRect) {
  if (initialRect === void 0) {
    initialRect = {
      width: 0,
      height: 0
    };
  }
  var _React$useState = import_react.default.useState(nodeRef.current), element = _React$useState[0], setElement = _React$useState[1];
  var _React$useReducer = import_react.default.useReducer(rectReducer, initialRect), rect = _React$useReducer[0], dispatch = _React$useReducer[1];
  var initialRectSet = import_react.default.useRef(false);
  useIsomorphicLayoutEffect(function() {
    if (nodeRef.current !== element) {
      setElement(nodeRef.current);
    }
  });
  useIsomorphicLayoutEffect(function() {
    if (element && !initialRectSet.current) {
      initialRectSet.current = true;
      var _rect = element.getBoundingClientRect();
      dispatch({
        rect: _rect
      });
    }
  }, [element]);
  import_react.default.useEffect(function() {
    if (!element) {
      return;
    }
    var observer = observeRect(element, function(rect2) {
      dispatch({
        rect: rect2
      });
    });
    observer.observe();
    return function() {
      observer.unobserve();
    };
  }, [element]);
  return rect;
}
function rectReducer(state, action) {
  var rect = action.rect;
  if (state.height !== rect.height || state.width !== rect.width) {
    return rect;
  }
  return state;
}
function useVirtual(_ref) {
  var _measurements;
  var _ref$size = _ref.size, size = _ref$size === void 0 ? 0 : _ref$size, _ref$estimateSize = _ref.estimateSize, estimateSize = _ref$estimateSize === void 0 ? defaultEstimateSize : _ref$estimateSize, _ref$overscan = _ref.overscan, overscan = _ref$overscan === void 0 ? 1 : _ref$overscan, _ref$paddingStart = _ref.paddingStart, paddingStart = _ref$paddingStart === void 0 ? 0 : _ref$paddingStart, _ref$paddingEnd = _ref.paddingEnd, paddingEnd = _ref$paddingEnd === void 0 ? 0 : _ref$paddingEnd, parentRef = _ref.parentRef, horizontal = _ref.horizontal, scrollToFn = _ref.scrollToFn, useObserver = _ref.useObserver, initialRect = _ref.initialRect, onScrollElement = _ref.onScrollElement, scrollOffsetFn = _ref.scrollOffsetFn, _ref$keyExtractor = _ref.keyExtractor, keyExtractor = _ref$keyExtractor === void 0 ? defaultKeyExtractor : _ref$keyExtractor, _ref$measureSize = _ref.measureSize, measureSize = _ref$measureSize === void 0 ? defaultMeasureSize : _ref$measureSize, _ref$rangeExtractor = _ref.rangeExtractor, rangeExtractor = _ref$rangeExtractor === void 0 ? defaultRangeExtractor : _ref$rangeExtractor;
  var sizeKey = horizontal ? "width" : "height";
  var scrollKey = horizontal ? "scrollLeft" : "scrollTop";
  var latestRef = import_react.default.useRef({
    scrollOffset: 0,
    measurements: []
  });
  var _React$useState = import_react.default.useState(0), scrollOffset = _React$useState[0], setScrollOffset = _React$useState[1];
  latestRef.current.scrollOffset = scrollOffset;
  var useMeasureParent = useObserver || useRect;
  var _useMeasureParent = useMeasureParent(parentRef, initialRect), outerSize = _useMeasureParent[sizeKey];
  latestRef.current.outerSize = outerSize;
  var defaultScrollToFn = import_react.default.useCallback(function(offset) {
    if (parentRef.current) {
      parentRef.current[scrollKey] = offset;
    }
  }, [parentRef, scrollKey]);
  var resolvedScrollToFn = scrollToFn || defaultScrollToFn;
  scrollToFn = import_react.default.useCallback(function(offset) {
    resolvedScrollToFn(offset, defaultScrollToFn);
  }, [defaultScrollToFn, resolvedScrollToFn]);
  var _React$useState2 = import_react.default.useState({}), measuredCache = _React$useState2[0], setMeasuredCache = _React$useState2[1];
  var measure = import_react.default.useCallback(function() {
    return setMeasuredCache({});
  }, []);
  var pendingMeasuredCacheIndexesRef = import_react.default.useRef([]);
  var measurements = import_react.default.useMemo(function() {
    var min = pendingMeasuredCacheIndexesRef.current.length > 0 ? Math.min.apply(Math, pendingMeasuredCacheIndexesRef.current) : 0;
    pendingMeasuredCacheIndexesRef.current = [];
    var measurements2 = latestRef.current.measurements.slice(0, min);
    for (var i = min; i < size; i++) {
      var key = keyExtractor(i);
      var measuredSize = measuredCache[key];
      var _start = measurements2[i - 1] ? measurements2[i - 1].end : paddingStart;
      var _size = typeof measuredSize === "number" ? measuredSize : estimateSize(i);
      var _end = _start + _size;
      measurements2[i] = {
        index: i,
        start: _start,
        size: _size,
        end: _end,
        key
      };
    }
    return measurements2;
  }, [estimateSize, measuredCache, paddingStart, size, keyExtractor]);
  var totalSize = (((_measurements = measurements[size - 1]) == null ? void 0 : _measurements.end) || paddingStart) + paddingEnd;
  latestRef.current.measurements = measurements;
  latestRef.current.totalSize = totalSize;
  var element = onScrollElement ? onScrollElement.current : parentRef.current;
  var scrollOffsetFnRef = import_react.default.useRef(scrollOffsetFn);
  scrollOffsetFnRef.current = scrollOffsetFn;
  useIsomorphicLayoutEffect(function() {
    if (!element) {
      setScrollOffset(0);
      return;
    }
    var onScroll = function onScroll2(event) {
      var offset = scrollOffsetFnRef.current ? scrollOffsetFnRef.current(event) : element[scrollKey];
      setScrollOffset(offset);
    };
    onScroll();
    element.addEventListener("scroll", onScroll, {
      capture: false,
      passive: true
    });
    return function() {
      element.removeEventListener("scroll", onScroll);
    };
  }, [element, scrollKey]);
  var _calculateRange = calculateRange(latestRef.current), start = _calculateRange.start, end = _calculateRange.end;
  var indexes = import_react.default.useMemo(function() {
    return rangeExtractor({
      start,
      end,
      overscan,
      size: measurements.length
    });
  }, [start, end, overscan, measurements.length, rangeExtractor]);
  var measureSizeRef = import_react.default.useRef(measureSize);
  measureSizeRef.current = measureSize;
  var virtualItems = import_react.default.useMemo(function() {
    var virtualItems2 = [];
    var _loop = function _loop2(k2, len2) {
      var i = indexes[k2];
      var measurement = measurements[i];
      var item = _extends(_extends({}, measurement), {}, {
        measureRef: function measureRef(el) {
          if (el) {
            var measuredSize = measureSizeRef.current(el, horizontal);
            if (measuredSize !== item.size) {
              var _scrollOffset = latestRef.current.scrollOffset;
              if (item.start < _scrollOffset) {
                defaultScrollToFn(_scrollOffset + (measuredSize - item.size));
              }
              pendingMeasuredCacheIndexesRef.current.push(i);
              setMeasuredCache(function(old) {
                var _extends2;
                return _extends(_extends({}, old), {}, (_extends2 = {}, _extends2[item.key] = measuredSize, _extends2));
              });
            }
          }
        }
      });
      virtualItems2.push(item);
    };
    for (var k = 0, len = indexes.length; k < len; k++) {
      _loop(k);
    }
    return virtualItems2;
  }, [indexes, defaultScrollToFn, horizontal, measurements]);
  var mountedRef = import_react.default.useRef(false);
  useIsomorphicLayoutEffect(function() {
    if (mountedRef.current) {
      setMeasuredCache({});
    }
    mountedRef.current = true;
  }, [estimateSize]);
  var scrollToOffset = import_react.default.useCallback(function(toOffset, _temp) {
    var _ref2 = _temp === void 0 ? {} : _temp, _ref2$align = _ref2.align, align = _ref2$align === void 0 ? "start" : _ref2$align;
    var _latestRef$current = latestRef.current, scrollOffset2 = _latestRef$current.scrollOffset, outerSize2 = _latestRef$current.outerSize;
    if (align === "auto") {
      if (toOffset <= scrollOffset2) {
        align = "start";
      } else if (toOffset >= scrollOffset2 + outerSize2) {
        align = "end";
      } else {
        align = "start";
      }
    }
    if (align === "start") {
      scrollToFn(toOffset);
    } else if (align === "end") {
      scrollToFn(toOffset - outerSize2);
    } else if (align === "center") {
      scrollToFn(toOffset - outerSize2 / 2);
    }
  }, [scrollToFn]);
  var tryScrollToIndex = import_react.default.useCallback(function(index, _temp2) {
    var _ref3 = _temp2 === void 0 ? {} : _temp2, _ref3$align = _ref3.align, align = _ref3$align === void 0 ? "auto" : _ref3$align, rest = _objectWithoutPropertiesLoose(_ref3, ["align"]);
    var _latestRef$current2 = latestRef.current, measurements2 = _latestRef$current2.measurements, scrollOffset2 = _latestRef$current2.scrollOffset, outerSize2 = _latestRef$current2.outerSize;
    var measurement = measurements2[Math.max(0, Math.min(index, size - 1))];
    if (!measurement) {
      return;
    }
    if (align === "auto") {
      if (measurement.end >= scrollOffset2 + outerSize2) {
        align = "end";
      } else if (measurement.start <= scrollOffset2) {
        align = "start";
      } else {
        return;
      }
    }
    var toOffset = align === "center" ? measurement.start + measurement.size / 2 : align === "end" ? measurement.end : measurement.start;
    scrollToOffset(toOffset, _extends({
      align
    }, rest));
  }, [scrollToOffset, size]);
  var scrollToIndex = import_react.default.useCallback(function() {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    tryScrollToIndex.apply(void 0, args);
    requestAnimationFrame(function() {
      tryScrollToIndex.apply(void 0, args);
    });
  }, [tryScrollToIndex]);
  return {
    virtualItems,
    totalSize,
    scrollToOffset,
    scrollToIndex,
    measure
  };
}
function calculateRange(_ref4) {
  var measurements = _ref4.measurements, outerSize = _ref4.outerSize, scrollOffset = _ref4.scrollOffset;
  var size = measurements.length - 1;
  var getOffset = function getOffset2(index) {
    return measurements[index].start;
  };
  var start = findNearestBinarySearch(0, size, getOffset, scrollOffset);
  var end = start;
  while (end < size && measurements[end].end < scrollOffset + outerSize) {
    end++;
  }
  return {
    start,
    end
  };
}
var import_react, props, rectChanged, observedNodes, rafId, run, useIsomorphicLayoutEffect, defaultEstimateSize, defaultKeyExtractor, defaultMeasureSize, defaultRangeExtractor, findNearestBinarySearch;
var init_react_virtual = __esm({
  "node_modules/react-virtual/dist/react-virtual.mjs"() {
    import_react = __toESM(require_react(), 1);
    props = ["bottom", "height", "left", "right", "top", "width"];
    rectChanged = function rectChanged2(a, b) {
      if (a === void 0) {
        a = {};
      }
      if (b === void 0) {
        b = {};
      }
      return props.some(function(prop) {
        return a[prop] !== b[prop];
      });
    };
    observedNodes = /* @__PURE__ */ new Map();
    run = function run2() {
      var changedStates = [];
      observedNodes.forEach(function(state, node) {
        var newRect = node.getBoundingClientRect();
        if (rectChanged(newRect, state.rect)) {
          state.rect = newRect;
          changedStates.push(state);
        }
      });
      changedStates.forEach(function(state) {
        state.callbacks.forEach(function(cb) {
          return cb(state.rect);
        });
      });
      rafId = window.requestAnimationFrame(run2);
    };
    useIsomorphicLayoutEffect = typeof window !== "undefined" ? import_react.default.useLayoutEffect : import_react.default.useEffect;
    defaultEstimateSize = function defaultEstimateSize2() {
      return 50;
    };
    defaultKeyExtractor = function defaultKeyExtractor2(index) {
      return index;
    };
    defaultMeasureSize = function defaultMeasureSize2(el, horizontal) {
      var key = horizontal ? "offsetWidth" : "offsetHeight";
      return el[key];
    };
    defaultRangeExtractor = function defaultRangeExtractor2(range) {
      var start = Math.max(range.start - range.overscan, 0);
      var end = Math.min(range.end + range.overscan, range.size - 1);
      var arr = [];
      for (var i = start; i <= end; i++) {
        arr.push(i);
      }
      return arr;
    };
    findNearestBinarySearch = function findNearestBinarySearch2(low, high, getCurrentValue, value) {
      while (low <= high) {
        var middle = (low + high) / 2 | 0;
        var currentValue = getCurrentValue(middle);
        if (currentValue < value) {
          low = middle + 1;
        } else if (currentValue > value) {
          high = middle - 1;
        } else {
          return middle;
        }
      }
      if (low > 0) {
        return low - 1;
      } else {
        return 0;
      }
    };
  }
});

// node_modules/kbar/lib/KBarResults.js
var require_KBarResults = __commonJS({
  "node_modules/kbar/lib/KBarResults.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarResults = void 0;
    var React6 = __importStar(require_react());
    var react_virtual_1 = (init_react_virtual(), __toCommonJS(react_virtual_exports));
    var KBarSearch_1 = require_KBarSearch();
    var useKBar_1 = require_useKBar();
    var utils_1 = require_utils();
    var START_INDEX = 0;
    var KBarResults3 = function(props2) {
      var activeRef = React6.useRef(null);
      var parentRef = React6.useRef(null);
      var itemsRef = React6.useRef(props2.items);
      itemsRef.current = props2.items;
      var rowVirtualizer = (0, react_virtual_1.useVirtual)({
        size: itemsRef.current.length,
        parentRef
      });
      var _a = (0, useKBar_1.useKBar)(function(state) {
        return {
          search: state.searchQuery,
          currentRootActionId: state.currentRootActionId,
          activeIndex: state.activeIndex
        };
      }), query = _a.query, search = _a.search, currentRootActionId = _a.currentRootActionId, activeIndex = _a.activeIndex, options = _a.options;
      React6.useEffect(function() {
        var handler = function(event) {
          var _a2;
          if (event.isComposing) {
            return;
          }
          if (event.key === "ArrowUp" || event.ctrlKey && event.key === "p") {
            event.preventDefault();
            query.setActiveIndex(function(index) {
              var nextIndex = index > START_INDEX ? index - 1 : index;
              if (typeof itemsRef.current[nextIndex] === "string") {
                if (nextIndex === 0)
                  return index;
                nextIndex -= 1;
              }
              return nextIndex;
            });
          } else if (event.key === "ArrowDown" || event.ctrlKey && event.key === "n") {
            event.preventDefault();
            query.setActiveIndex(function(index) {
              var nextIndex = index < itemsRef.current.length - 1 ? index + 1 : index;
              if (typeof itemsRef.current[nextIndex] === "string") {
                if (nextIndex === itemsRef.current.length - 1)
                  return index;
                nextIndex += 1;
              }
              return nextIndex;
            });
          } else if (event.key === "Enter") {
            event.preventDefault();
            (_a2 = activeRef.current) === null || _a2 === void 0 ? void 0 : _a2.click();
          }
        };
        window.addEventListener("keydown", handler);
        return function() {
          return window.removeEventListener("keydown", handler);
        };
      }, [query]);
      var scrollToIndex = rowVirtualizer.scrollToIndex;
      React6.useEffect(function() {
        scrollToIndex(activeIndex, {
          // ensure that if the first item in the list is a group
          // name and we are focused on the second item, to not
          // scroll past that group, hiding it.
          align: activeIndex <= 1 ? "end" : "auto"
        });
      }, [activeIndex, scrollToIndex]);
      React6.useEffect(function() {
        query.setActiveIndex(
          // avoid setting active index on a group
          typeof props2.items[START_INDEX] === "string" ? START_INDEX + 1 : START_INDEX
        );
      }, [search, currentRootActionId, props2.items, query]);
      var execute = React6.useCallback(function(item) {
        var _a2, _b;
        if (typeof item === "string")
          return;
        if (item.command) {
          item.command.perform(item);
          query.toggle();
        } else {
          query.setSearch("");
          query.setCurrentRootAction(item.id);
        }
        (_b = (_a2 = options.callbacks) === null || _a2 === void 0 ? void 0 : _a2.onSelectAction) === null || _b === void 0 ? void 0 : _b.call(_a2, item);
      }, [query, options]);
      var pointerMoved = (0, utils_1.usePointerMovedSinceMount)();
      return React6.createElement(
        "div",
        { ref: parentRef, style: {
          maxHeight: props2.maxHeight || 400,
          position: "relative",
          overflow: "auto"
        } },
        React6.createElement("div", { role: "listbox", id: KBarSearch_1.KBAR_LISTBOX, style: {
          height: rowVirtualizer.totalSize + "px",
          width: "100%"
        } }, rowVirtualizer.virtualItems.map(function(virtualRow) {
          var item = itemsRef.current[virtualRow.index];
          var handlers = typeof item !== "string" && {
            onPointerMove: function() {
              return pointerMoved && activeIndex !== virtualRow.index && query.setActiveIndex(virtualRow.index);
            },
            onPointerDown: function() {
              return query.setActiveIndex(virtualRow.index);
            },
            onClick: function() {
              return execute(item);
            }
          };
          var active = virtualRow.index === activeIndex;
          return React6.createElement("div", __assign({ ref: active ? activeRef : null, id: (0, KBarSearch_1.getListboxItemId)(virtualRow.index), role: "option", "aria-selected": active, key: virtualRow.index, style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: "translateY(" + virtualRow.start + "px)"
          } }, handlers), React6.cloneElement(props2.onRender({
            item,
            active
          }), {
            ref: virtualRow.measureRef
          }));
        }))
      );
    };
    exports.KBarResults = KBarResults3;
  }
});

// node_modules/kbar/lib/useRegisterActions.js
var require_useRegisterActions = __commonJS({
  "node_modules/kbar/lib/useRegisterActions.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.useRegisterActions = void 0;
    var React6 = __importStar(require_react());
    var useKBar_1 = require_useKBar();
    function useRegisterActions3(actions, dependencies) {
      if (dependencies === void 0) {
        dependencies = [];
      }
      var query = (0, useKBar_1.useKBar)().query;
      var actionsCache = React6.useMemo(function() {
        return actions;
      }, dependencies);
      React6.useEffect(function() {
        if (!actionsCache.length) {
          return;
        }
        var unregister = query.registerActions(actionsCache);
        return function() {
          unregister();
        };
      }, [query, actionsCache]);
    }
    exports.useRegisterActions = useRegisterActions3;
  }
});

// node_modules/kbar/lib/KBarAnimator.js
var require_KBarAnimator = __commonJS({
  "node_modules/kbar/lib/KBarAnimator.js"(exports) {
    "use strict";
    var __assign = exports && exports.__assign || function() {
      __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.KBarAnimator = void 0;
    var React6 = __importStar(require_react());
    var types_1 = require_types();
    var useKBar_1 = require_useKBar();
    var utils_1 = require_utils();
    var appearanceAnimationKeyframes = [
      {
        opacity: 0,
        transform: "scale(.99)"
      },
      { opacity: 1, transform: "scale(1.01)" },
      { opacity: 1, transform: "scale(1)" }
    ];
    var bumpAnimationKeyframes = [
      {
        transform: "scale(1)"
      },
      {
        transform: "scale(.98)"
      },
      {
        transform: "scale(1)"
      }
    ];
    var KBarAnimator3 = function(_a) {
      var _b, _c;
      var children = _a.children, style = _a.style, className = _a.className;
      var _d = (0, useKBar_1.useKBar)(function(state) {
        return {
          visualState: state.visualState,
          currentRootActionId: state.currentRootActionId
        };
      }), visualState = _d.visualState, currentRootActionId = _d.currentRootActionId, query = _d.query, options = _d.options;
      var outerRef = React6.useRef(null);
      var innerRef = React6.useRef(null);
      var enterMs = ((_b = options === null || options === void 0 ? void 0 : options.animations) === null || _b === void 0 ? void 0 : _b.enterMs) || 0;
      var exitMs = ((_c = options === null || options === void 0 ? void 0 : options.animations) === null || _c === void 0 ? void 0 : _c.exitMs) || 0;
      React6.useEffect(function() {
        if (visualState === types_1.VisualState.showing) {
          return;
        }
        var duration = visualState === types_1.VisualState.animatingIn ? enterMs : exitMs;
        var element = outerRef.current;
        element === null || element === void 0 ? void 0 : element.animate(appearanceAnimationKeyframes, {
          duration,
          easing: (
            // TODO: expose easing in options
            visualState === types_1.VisualState.animatingOut ? "ease-in" : "ease-out"
          ),
          direction: visualState === types_1.VisualState.animatingOut ? "reverse" : "normal",
          fill: "forwards"
        });
      }, [options, visualState, enterMs, exitMs]);
      var previousHeight = React6.useRef();
      React6.useEffect(function() {
        if (visualState === types_1.VisualState.showing) {
          var outer_1 = outerRef.current;
          var inner_1 = innerRef.current;
          if (!outer_1 || !inner_1) {
            return;
          }
          var ro_1 = new ResizeObserver(function(entries) {
            for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
              var entry = entries_1[_i];
              var cr = entry.contentRect;
              if (!previousHeight.current) {
                previousHeight.current = cr.height;
              }
              outer_1.animate([
                {
                  height: previousHeight.current + "px"
                },
                {
                  height: cr.height + "px"
                }
              ], {
                duration: enterMs / 2,
                // TODO: expose configs here
                easing: "ease-out",
                fill: "forwards"
              });
              previousHeight.current = cr.height;
            }
          });
          ro_1.observe(inner_1);
          return function() {
            ro_1.unobserve(inner_1);
          };
        }
      }, [visualState, options, enterMs, exitMs]);
      var firstRender = React6.useRef(true);
      React6.useEffect(function() {
        if (firstRender.current) {
          firstRender.current = false;
          return;
        }
        var element = outerRef.current;
        if (element) {
          element.animate(bumpAnimationKeyframes, {
            duration: enterMs,
            easing: "ease-out"
          });
        }
      }, [currentRootActionId, enterMs]);
      (0, utils_1.useOuterClick)(outerRef, function() {
        var _a2, _b2;
        query.setVisualState(types_1.VisualState.animatingOut);
        (_b2 = (_a2 = options.callbacks) === null || _a2 === void 0 ? void 0 : _a2.onClose) === null || _b2 === void 0 ? void 0 : _b2.call(_a2);
      });
      return React6.createElement(
        "div",
        { ref: outerRef, style: __assign(__assign(__assign({}, appearanceAnimationKeyframes[0]), style), { pointerEvents: "auto" }), className },
        React6.createElement("div", { ref: innerRef }, children)
      );
    };
    exports.KBarAnimator = KBarAnimator3;
  }
});

// node_modules/kbar/lib/action/index.js
var require_action = __commonJS({
  "node_modules/kbar/lib/action/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_ActionInterface(), exports);
    __exportStar(require_ActionImpl(), exports);
  }
});

// node_modules/kbar/lib/index.js
var require_lib = __commonJS({
  "node_modules/kbar/lib/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: function() {
        return m[k];
      } });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Priority = exports.createAction = void 0;
    var utils_1 = require_utils();
    Object.defineProperty(exports, "createAction", { enumerable: true, get: function() {
      return utils_1.createAction;
    } });
    Object.defineProperty(exports, "Priority", { enumerable: true, get: function() {
      return utils_1.Priority;
    } });
    __exportStar(require_useMatches(), exports);
    __exportStar(require_KBarPortal(), exports);
    __exportStar(require_KBarPositioner(), exports);
    __exportStar(require_KBarSearch(), exports);
    __exportStar(require_KBarResults(), exports);
    __exportStar(require_useKBar(), exports);
    __exportStar(require_useRegisterActions(), exports);
    __exportStar(require_KBarContextProvider(), exports);
    __exportStar(require_KBarAnimator(), exports);
    __exportStar(require_types(), exports);
    __exportStar(require_action(), exports);
  }
});

// node_modules/@refinedev/kbar/dist/index.mjs
var import_react2 = __toESM(require_react(), 1);
var import_kbar = __toESM(require_lib(), 1);
var import_kbar2 = __toESM(require_lib(), 1);
var import_react3 = __toESM(require_react(), 1);
var import_kbar3 = __toESM(require_lib(), 1);
var import_react4 = __toESM(require_react(), 1);
var import_kbar4 = __toESM(require_lib(), 1);
var import_react5 = __toESM(require_react(), 1);
var import_kbar5 = __toESM(require_lib(), 1);
var import_react6 = __toESM(require_react(), 1);
var import_react7 = __toESM(require_react(), 1);
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var capitalize = __name((str) => str.replace(
  /\w\S*/g,
  (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
), "capitalize");
var useRefineKbar = __name(() => {
  const t = useTranslate();
  const {
    id: idFromParams,
    action: actionFromParams,
    resource: resourceFromParams,
    resources
  } = useResourceParams();
  const getToPath = useGetToPath();
  const go = useGo();
  const {
    mutation: { mutate }
  } = useDelete();
  const getUserFriendlyName = useUserFriendlyName();
  const kbarContext = (0, import_react3.useContext)(import_kbar3.KBarContext);
  const { can } = useCanWithoutCache();
  const [actions, setActions] = (0, import_react3.useState)([]);
  (0, import_react3.useEffect)(() => {
    const preaparedActions = __name(async () => {
      return await Promise.all(
        moveActionToFirst().flatMap((resource) => {
          return createActionWithResource(resource);
        })
      );
    }, "preaparedActions");
    preaparedActions().then((actions2) => {
      return setActions(actions2.flatMap((action) => action));
    });
  }, [resources, idFromParams, resourceFromParams, actionFromParams]);
  (0, import_react3.useEffect)(() => {
    if (actions.length === 0) {
      kbarContext.query.setVisualState(import_kbar3.VisualState.hidden);
    }
  }, [actions]);
  const moveActionToFirst = __name(() => {
    const orderedResources = [...resources];
    const fromIndex = orderedResources == null ? void 0 : orderedResources.findIndex(
      (resource) => (resource.identifier ?? (resource == null ? void 0 : resource.name)) === ((resourceFromParams == null ? void 0 : resourceFromParams.identifier) ?? (resourceFromParams == null ? void 0 : resourceFromParams.name))
    );
    if (fromIndex > 0) {
      const element = orderedResources[fromIndex];
      orderedResources.splice(fromIndex, 1);
      orderedResources.splice(0, 0, element);
    }
    return orderedResources;
  }, "moveActionToFirst");
  const createActionWithResource = __name(async (resource) => {
    var _a, _b, _c, _d, _e, _f;
    const { name, list, create, show, edit } = resource;
    const label = (_a = resource == null ? void 0 : resource.meta) == null ? void 0 : _a.label;
    const icon = (_b = resource == null ? void 0 : resource.meta) == null ? void 0 : _b.icon;
    const canDelete = (_c = resource == null ? void 0 : resource.meta) == null ? void 0 : _c.canDelete;
    const section = label ?? t(
      `${resource.name}.${resource.name}`,
      getUserFriendlyName(resource.name, "plural")
    );
    const tempActions = [];
    if (list && (resourceFromParams !== void 0 && (resourceFromParams == null ? void 0 : resourceFromParams.name) !== name || actionFromParams !== void 0 && (resourceFromParams == null ? void 0 : resourceFromParams.name) === name)) {
      const { can: canList } = await (can == null ? void 0 : can({
        resource: name,
        action: "list",
        params: { id: idFromParams, resource }
      })) || { can: true };
      if (canList) {
        tempActions.push(
          (0, import_kbar3.createAction)({
            name: t("actions.list", capitalize(
              "list"
              /* List */
            )),
            section,
            icon,
            perform: () => {
              const p = getToPath({
                resource,
                action: "list"
              });
              if (p) {
                go({ to: p });
              }
            }
          })
        );
      }
    }
    if ((((_d = resource == null ? void 0 : resource.meta) == null ? void 0 : _d.canCreate) || !!create) && create && ("create" !== actionFromParams || (resourceFromParams == null ? void 0 : resourceFromParams.name) !== name)) {
      const { can: canAccessCreate } = await (can == null ? void 0 : can({
        resource: name,
        action: "create",
        params: { resource }
      })) || { can: true };
      if (canAccessCreate) {
        tempActions.push(
          (0, import_kbar3.createAction)({
            name: t("actions.create", capitalize(
              "create"
              /* Create */
            )),
            section,
            icon,
            keywords: "new",
            perform: () => {
              const p = getToPath({
                resource,
                action: "create"
              });
              if (p) {
                go({ to: p });
              }
            }
          })
        );
      }
    }
    if ((resourceFromParams == null ? void 0 : resourceFromParams.name) === name && idFromParams) {
      if ((((_e = resource == null ? void 0 : resource.meta) == null ? void 0 : _e.canShow) || !!show) && show && "show" !== actionFromParams) {
        const { can: canAccessShow } = await (can == null ? void 0 : can({
          resource: name,
          action: "show",
          params: { id: idFromParams, resource }
        })) || { can: true };
        if (canAccessShow) {
          tempActions.push(
            (0, import_kbar3.createAction)({
              name: t("actions.show", capitalize(
                "show"
                /* Show */
              )),
              section,
              icon,
              perform: () => {
                const p = getToPath({
                  resource,
                  action: "show",
                  meta: {
                    id: idFromParams
                  }
                });
                if (p) {
                  go({ to: p });
                }
              }
            })
          );
        }
      }
      if ((((_f = resource == null ? void 0 : resource.meta) == null ? void 0 : _f.canEdit) || !!edit) && edit && "edit" !== actionFromParams) {
        const { can: canAccessEdit } = await (can == null ? void 0 : can({
          resource: name,
          action: "edit",
          params: { id: idFromParams, resource }
        })) || { can: true };
        if (canAccessEdit) {
          tempActions.push(
            (0, import_kbar3.createAction)({
              name: t("actions.edit", capitalize(
                "edit"
                /* Edit */
              )),
              section,
              icon,
              perform: () => {
                const p = getToPath({
                  resource,
                  action: "edit",
                  meta: {
                    id: idFromParams
                  }
                });
                if (p) {
                  go({ to: p });
                }
              }
            })
          );
        }
      }
      if (canDelete) {
        const { can: canAccessDelete } = await (can == null ? void 0 : can({
          resource: name,
          action: "delete",
          params: { id: idFromParams, resource }
        })) || { can: true };
        if (canAccessDelete) {
          tempActions.push(
            {
              id: "delete",
              name: t(
                "actions.delete",
                capitalize(
                  "delete"
                  /* Delete */
                )
              ),
              section,
              icon
            },
            (0, import_kbar3.createAction)({
              name: t(
                "buttons.delete",
                capitalize(
                  "delete"
                  /* Delete */
                )
              ),
              section: t("buttons.confirm", "Are you sure?"),
              parent: "delete",
              perform: () => {
                mutate(
                  {
                    resource: resource.name,
                    id: idFromParams
                  },
                  {
                    onSuccess: () => {
                      const p = getToPath({
                        resource,
                        action: "list"
                      });
                      if (p) {
                        go({ to: p });
                      }
                    }
                  }
                );
              }
            }),
            (0, import_kbar3.createAction)({
              name: t("buttons.cancel", "Cancel"),
              parent: "delete",
              perform: () => null
            })
          );
        }
      }
    }
    return tempActions;
  }, "createActionWithResource");
  (0, import_kbar3.useRegisterActions)(actions, [actions]);
}, "useRefineKbar");
var CommandBar = __name(() => {
  const searchStyle = {
    padding: "12px 16px",
    fontSize: "16px",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    border: "none",
    background: "rgb(252 252 252)",
    color: "black"
  };
  const animatorStyle = {
    maxWidth: "600px",
    width: "100%",
    background: "white",
    color: "black",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0px 4px 4px rgba(0, 0, 0, 0.25)"
  };
  const positionerStyle = {
    opacity: 1,
    transition: "background 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0s",
    backdropFilter: "saturate(180%) blur(1px)",
    background: "rgba(0, 0, 0, 0.1)",
    zIndex: "9999"
  };
  return import_react4.default.createElement(import_kbar4.KBarPortal, null, import_react4.default.createElement(import_kbar4.KBarPositioner, { style: positionerStyle }, import_react4.default.createElement(import_kbar4.KBarAnimator, { style: animatorStyle }, import_react4.default.createElement(import_kbar4.KBarSearch, { style: searchStyle }), import_react4.default.createElement(RenderResults, null))));
}, "CommandBar");
var groupNameStyle = {
  padding: "8px 16px",
  fontSize: "14px",
  textTransform: "uppercase",
  fontWeight: "bold",
  opacity: 0.5
};
var RenderResults = __name(() => {
  const { results, rootActionId } = (0, import_kbar5.useMatches)();
  return import_react5.default.createElement(
    import_kbar5.KBarResults,
    {
      items: results,
      onRender: ({ item, active }) => {
        return typeof item === "string" ? import_react5.default.createElement("div", { style: groupNameStyle }, item) : import_react5.default.createElement(
          ResultItem,
          {
            action: item,
            active,
            currentRootActionId: rootActionId
          }
        );
      }
    }
  );
}, "RenderResults");
var ResultItem = import_react6.default.forwardRef(
  ({ action, active, currentRootActionId }, ref) => {
    var _a;
    const ancestors = import_react6.default.useMemo(() => {
      if (!currentRootActionId)
        return action.ancestors;
      const index = action.ancestors.findIndex(
        (ancestor) => ancestor.id === currentRootActionId
      );
      return action.ancestors.slice(index + 1);
    }, [action.ancestors, currentRootActionId]);
    return import_react6.default.createElement(
      "div",
      {
        ref,
        style: {
          padding: "12px 16px",
          background: active ? "rgba(0 0 0 / 0.05)" : "transparent",
          borderLeft: `2px solid ${active ? "rgb(28 28 29)" : "transparent"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer"
        }
      },
      import_react6.default.createElement(
        "div",
        {
          style: {
            display: "flex",
            gap: "8px",
            alignItems: "center",
            fontSize: 14
          }
        },
        action.icon && action.icon,
        import_react6.default.createElement("div", { style: { display: "flex", flexDirection: "column" } }, import_react6.default.createElement("div", null, ancestors.length > 0 && ancestors.map((ancestor) => import_react6.default.createElement(import_react6.default.Fragment, { key: ancestor.id }, import_react6.default.createElement(
          "span",
          {
            style: {
              opacity: 0.5,
              marginRight: 8
            }
          },
          ancestor.name
        ), import_react6.default.createElement(
          "span",
          {
            style: {
              marginRight: 8
            }
          },
          "›"
        ))), import_react6.default.createElement(
          "span",
          {
            style: {
              color: action.name.toLocaleUpperCase() === "DELETE" ? "red" : "black"
            }
          },
          action.name
        )), action.subtitle && import_react6.default.createElement("span", { style: { fontSize: 12 } }, action.subtitle))
      ),
      ((_a = action.shortcut) == null ? void 0 : _a.length) ? import_react6.default.createElement(
        "div",
        {
          "aria-hidden": true,
          style: {
            display: "grid",
            gridAutoFlow: "column",
            gap: "4px"
          }
        },
        action.shortcut.map((sc) => import_react6.default.createElement(
          "kbd",
          {
            key: sc,
            style: {
              padding: "4px 6px",
              background: "rgba(0 0 0 / .1)",
              borderRadius: "4px",
              fontSize: 14
            }
          },
          sc
        ))
      ) : null
    );
  }
);
ResultItem.displayName = "ResultItem";
var RefineKbar = __name(({ commandBarProps }) => {
  const context = (0, import_react7.useContext)(RefineKbarPropsContext);
  useRefineKbar();
  const props2 = { ...context, ...commandBarProps };
  return import_react7.default.createElement(CommandBar, { ...props2 });
}, "RefineKbar");
var RefineKbarPropsContext = (0, import_react2.createContext)({});
var RefineKbarProvider = __name(({ children, commandBarProps }) => {
  return import_react2.default.createElement(RefineKbarPropsContext.Provider, { value: commandBarProps ?? {} }, import_react2.default.createElement(import_kbar.KBarProvider, null, children));
}, "RefineKbarProvider");
var export_KBAR_LISTBOX = import_kbar2.KBAR_LISTBOX;
var export_KBarAnimator = import_kbar2.KBarAnimator;
var export_KBarContext = import_kbar2.KBarContext;
var export_KBarPortal = import_kbar2.KBarPortal;
var export_KBarPositioner = import_kbar2.KBarPositioner;
var export_KBarProvider = import_kbar2.KBarProvider;
var export_KBarResults = import_kbar2.KBarResults;
var export_KBarSearch = import_kbar2.KBarSearch;
var export_NO_GROUP = import_kbar2.NO_GROUP;
var export_Priority = import_kbar2.Priority;
var export_VisualState = import_kbar2.VisualState;
var export_createAction = import_kbar2.createAction;
var export_getListboxItemId = import_kbar2.getListboxItemId;
var export_useKBar = import_kbar2.useKBar;
var export_useMatches = import_kbar2.useMatches;
var export_useRegisterActions = import_kbar2.useRegisterActions;
export {
  export_KBAR_LISTBOX as KBAR_LISTBOX,
  export_KBarAnimator as KBarAnimator,
  export_KBarContext as KBarContext,
  export_KBarPortal as KBarPortal,
  export_KBarPositioner as KBarPositioner,
  export_KBarProvider as KBarProvider,
  export_KBarResults as KBarResults,
  export_KBarSearch as KBarSearch,
  export_NO_GROUP as NO_GROUP,
  export_Priority as Priority,
  RefineKbar,
  RefineKbarPropsContext,
  RefineKbarProvider,
  export_VisualState as VisualState,
  export_createAction as createAction,
  export_getListboxItemId as getListboxItemId,
  export_useKBar as useKBar,
  export_useMatches as useMatches,
  useRefineKbar,
  export_useRegisterActions as useRegisterActions
};
//# sourceMappingURL=@refinedev_kbar.js.map
