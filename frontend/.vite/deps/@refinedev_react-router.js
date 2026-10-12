import {
  Link,
  Navigate,
  NavigationContext,
  matchPath,
  useLocation,
  useNavigate,
  useParams
} from "./chunk-NDJF5SAK.js";
import {
  QS_PARSE_DEPTH,
  ResourceContext,
  generateDefaultDocumentTitle,
  matchResourceFromRoute,
  require_lib,
  useGetToPath,
  useParsed,
  useResourceParams,
  useTranslate,
  useUserFriendlyName,
  useWarnAboutChange
} from "./chunk-SYPME2GI.js";
import "./chunk-NWHHQHUP.js";
import {
  __toESM,
  require_react
} from "./chunk-7W76HJBA.js";

// node_modules/@refinedev/react-router/dist/index.mjs
var import_react = __toESM(require_react(), 1);
var import_react2 = __toESM(require_react(), 1);
var import_qs = __toESM(require_lib(), 1);
var import_react3 = __toESM(require_react(), 1);
var import_react4 = __toESM(require_react(), 1);
var import_react5 = __toESM(require_react(), 1);
var import_react6 = __toESM(require_react(), 1);
var import_react7 = __toESM(require_react(), 1);
var import_react8 = __toESM(require_react(), 1);
var convertToNumberIfPossible = (value) => {
  if (typeof value === "undefined") {
    return value;
  }
  const num = Number(value);
  if (`${num}` === value) {
    return num;
  }
  return value;
};
var stringifyConfig = {
  addQueryPrefix: true,
  skipNulls: true,
  arrayFormat: "indices",
  encode: false,
  encodeValuesOnly: true
};
var routerProvider = {
  go: () => {
    const { search: existingSearch, hash: existingHash } = useLocation();
    const navigate = useNavigate();
    const fn = (0, import_react2.useCallback)(
      ({
        to,
        type,
        query,
        hash,
        options: { keepQuery, keepHash } = {}
      }) => {
        const urlQuery = {
          ...keepQuery && existingSearch && import_qs.default.parse(existingSearch, {
            ignoreQueryPrefix: true,
            depth: QS_PARSE_DEPTH
          }),
          ...query
        };
        if (urlQuery.to) {
          urlQuery.to = encodeURIComponent(`${urlQuery.to}`);
        }
        const hasUrlQuery = Object.keys(urlQuery).length > 0;
        const urlHash = `#${(hash || keepHash && existingHash || "").replace(
          /^#/,
          ""
        )}`;
        const hasUrlHash = urlHash.length > 1;
        const urlTo = to || "";
        const fullPath = `${urlTo}${hasUrlQuery ? import_qs.default.stringify(urlQuery, stringifyConfig) : ""}${hasUrlHash ? urlHash : ""}`;
        if (type === "path") {
          return fullPath;
        }
        navigate(fullPath, {
          replace: type === "replace"
        });
        return;
      },
      [existingHash, existingSearch, navigate]
    );
    return fn;
  },
  back: () => {
    const navigate = useNavigate();
    const fn = (0, import_react2.useCallback)(() => {
      navigate(-1);
    }, [navigate]);
    return fn;
  },
  parse: () => {
    var _a;
    let params = useParams();
    const { pathname, search } = useLocation();
    const { resources } = (0, import_react2.useContext)(ResourceContext);
    const { resource, action, matchedRoute } = import_react.default.useMemo(() => {
      return matchResourceFromRoute(pathname, resources);
    }, [resources, pathname]);
    if (Object.entries(params).length === 0 && matchedRoute) {
      params = ((_a = matchPath(matchedRoute, pathname)) == null ? void 0 : _a.params) || {};
    }
    const fn = (0, import_react2.useCallback)(() => {
      const parsedSearch = import_qs.default.parse(search, {
        ignoreQueryPrefix: true,
        depth: QS_PARSE_DEPTH
      });
      const combinedParams = {
        ...params,
        ...parsedSearch
      };
      const response = {
        ...resource && { resource },
        ...action && { action },
        ...(params == null ? void 0 : params.id) && { id: decodeURIComponent(params.id) },
        // ...(params?.action && { action: params.action }), // lets see if there is a need for this
        pathname,
        params: {
          ...combinedParams,
          currentPage: convertToNumberIfPossible(
            combinedParams.currentPage
          ),
          pageSize: convertToNumberIfPossible(
            combinedParams.pageSize
          ),
          to: combinedParams.to ? decodeURIComponent(combinedParams.to) : void 0
        }
      };
      return response;
    }, [pathname, search, params, resource, action]);
    return fn;
  },
  Link: import_react.default.forwardRef(function RefineLink(props, ref) {
    return import_react.default.createElement(Link, { to: props.to, ...props, ref });
  })
};
var NavigateToResource = ({
  resource: resourceProp,
  fallbackTo,
  meta
}) => {
  const getToPath = useGetToPath();
  const { resource, resources } = useResourceParams({
    resource: resourceProp
  });
  const toResource = resource || resources.find((r) => r.list);
  if (toResource) {
    const path = getToPath({
      resource: toResource,
      action: "list",
      meta
    });
    if (path) {
      return import_react3.default.createElement(Navigate, { to: path });
    }
    return null;
  }
  if (fallbackTo) {
    console.warn(`No resource is found. navigation to ${fallbackTo}.`);
    return import_react3.default.createElement(Navigate, { to: fallbackTo });
  }
  console.warn(
    'No resource and "fallbackTo" is found. No navigation will be made.'
  );
  return null;
};
function useConfirmExit(confirmExit, when = true) {
  const { navigator } = import_react5.default.useContext(NavigationContext);
  import_react5.default.useEffect(() => {
    if (!when) {
      return;
    }
    const go = navigator.go;
    const push = navigator.push;
    navigator.push = (...args) => {
      const result = confirmExit();
      if (result !== false) {
        push(...args);
      }
    };
    navigator.go = (...args) => {
      const result = confirmExit();
      if (result !== false) {
        go(...args);
      }
    };
    return () => {
      navigator.push = push;
      navigator.go = go;
    };
  }, [navigator, confirmExit, when]);
}
function usePrompt(message, when = true, onConfirm) {
  const warnWhenListener = import_react5.default.useCallback(
    (e) => {
      e.preventDefault();
      e.returnValue = message;
      return e.returnValue;
    },
    [message]
  );
  import_react5.default.useEffect(() => {
    if (when) {
      window.addEventListener("beforeunload", warnWhenListener);
    }
    return () => {
      window.removeEventListener("beforeunload", warnWhenListener);
    };
  }, [warnWhenListener, when]);
  const confirmExit = import_react5.default.useCallback(() => {
    const confirm = window.confirm(message);
    if (confirm && onConfirm) {
      onConfirm();
    }
    return confirm;
  }, [message]);
  useConfirmExit(confirmExit, when);
}
var UnsavedChangesNotifier = ({
  translationKey = "warnWhenUnsavedChanges",
  message = "Are you sure you want to leave? You have unsaved changes."
}) => {
  const translate = useTranslate();
  const { pathname } = useLocation();
  const { warnWhen, setWarnWhen } = useWarnAboutChange();
  import_react4.default.useEffect(() => {
    return () => setWarnWhen == null ? void 0 : setWarnWhen(false);
  }, [pathname]);
  const warnMessage = import_react4.default.useMemo(() => {
    return translate(translationKey, message);
  }, [translationKey, message, translate]);
  usePrompt(warnMessage, warnWhen, () => {
    setWarnWhen == null ? void 0 : setWarnWhen(false);
  });
  return null;
};
var CatchAllNavigate = ({ to }) => {
  const { pathname, search } = useLocation();
  const queryValue = `${pathname}${search}`;
  const query = queryValue.length > 1 ? `?to=${encodeURIComponent(queryValue)}` : "";
  return import_react6.default.createElement(Navigate, { to: `${to}${query}` });
};
function DocumentTitleHandler({ handler }) {
  var _a;
  const location = useLocation();
  const { action, id, params, pathname, resource } = useParsed();
  const translate = useTranslate();
  const getUserFriendlyName = useUserFriendlyName();
  const identifier = (resource == null ? void 0 : resource.identifier) ?? (resource == null ? void 0 : resource.name);
  const preferredLabel = (_a = resource == null ? void 0 : resource.meta) == null ? void 0 : _a.label;
  const resourceName = preferredLabel ?? getUserFriendlyName(identifier, action === "list" ? "plural" : "singular");
  const populatedLabel = translate(
    `${resource == null ? void 0 : resource.name}.${resource == null ? void 0 : resource.name}`,
    resourceName
  );
  (0, import_react7.useLayoutEffect)(() => {
    const autoGeneratedTitle = generateDefaultDocumentTitle(
      translate,
      resource,
      action,
      `${id}`,
      resourceName,
      getUserFriendlyName
    );
    if (handler) {
      document.title = handler({
        action,
        resource: {
          ...resource ?? {},
          meta: {
            ...resource == null ? void 0 : resource.meta,
            label: populatedLabel
          }
        },
        params,
        pathname,
        autoGeneratedTitle
      });
    } else {
      document.title = autoGeneratedTitle;
    }
  }, [location]);
  return import_react7.default.createElement(import_react7.default.Fragment, null);
}
var useDocumentTitle = (title) => {
  const translate = useTranslate();
  (0, import_react8.useEffect)(() => {
    if (!title)
      return;
    if (typeof title === "string") {
      document.title = translate(title);
    } else {
      document.title = translate(title.i18nKey);
    }
  }, [title]);
  return (title2) => {
    if (typeof title2 === "string") {
      document.title = translate(title2);
    } else {
      document.title = translate(title2.i18nKey);
    }
  };
};
export {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
  routerProvider as default,
  stringifyConfig,
  useDocumentTitle
};
//# sourceMappingURL=@refinedev_react-router.js.map
