"use client";
import {
  require_react_dom
} from "./chunk-X7CDTWTX.js";
import {
  DevToolsContext,
  DevToolsContextProvider,
  DevtoolsEvent,
  debounce_default,
  send
} from "./chunk-NWHHQHUP.js";
import {
  __toESM,
  require_react
} from "./chunk-7W76HJBA.js";

// node_modules/@refinedev/devtools/dist/index.mjs
var import_react = __toESM(require_react(), 1);
var import_react2 = __toESM(require_react(), 1);
var import_react3 = __toESM(require_react(), 1);
var import_react4 = __toESM(require_react(), 1);

// node_modules/@aliemir/dom-to-fiber-utils/dist/index.mjs
var F = (e) => {
  let r = e, t;
  for (; !t && r; ) t = Object.keys(r).find((n) => n.startsWith("__reactFiber$")), t || (r = r.parentElement);
  return t && r ? r[t] : null;
};
var i = (e) => {
  var r, t, n, u;
  return e && (((r = e.type) == null ? void 0 : r.displayName) || ((t = e.type) == null ? void 0 : t.name) || ((n = e.elementType) == null ? void 0 : n.displayName) || ((u = e.elementType) == null ? void 0 : u.name)) || null;
};
var l = (e) => e.return || null;
var s = (e) => {
  let r = e;
  for (; r; ) {
    if (r.stateNode) return r;
    r = l(r);
  }
  return null;
};
var p = (e) => e.stateNode;
var o = (e) => {
  if (!e) return null;
  if (i(e)) return e;
  let r = l(e);
  return r ? o(r) : null;
};

// node_modules/@refinedev/devtools/dist/index.mjs
var import_react5 = __toESM(require_react(), 1);
var import_react6 = __toESM(require_react(), 1);
var import_react_dom = __toESM(require_react_dom(), 1);
var import_react7 = __toESM(require_react(), 1);
var React6 = __toESM(require_react(), 1);
var import_react8 = __toESM(require_react(), 1);
var import_react9 = __toESM(require_react(), 1);
var import_react10 = __toESM(require_react(), 1);
var getChildOfFiber = (fiber) => {
  if (!fiber) {
    return null;
  }
  return fiber.child;
};
var getFirstHTMLElementFromFiberByChild = (fiber) => {
  let child = fiber;
  while (child) {
    const element = p(child);
    if (element && element instanceof HTMLElement) {
      return element;
    }
    child = getChildOfFiber(child);
  }
  return null;
};
var getFirstHTMLElementFromFiberByParent = (fiber) => {
  let parent = fiber;
  while (parent) {
    const element = p(parent);
    if (element && element instanceof HTMLElement) {
      return element;
    }
    parent = l(parent);
  }
  return null;
};
var getFirstHTMLElementFromFiber = (fiber) => {
  let element = getFirstHTMLElementFromFiberByChild(fiber);
  if (element) {
    return [element, "child"];
  }
  element = getFirstHTMLElementFromFiberByParent(fiber);
  if (element) {
    return [element, "parent"];
  }
  return [document.body, "body"];
};
var selectFiber = (start, activeTraceItems) => {
  let fiber = start;
  let firstParentOfNodeWithName = null;
  let fiberWithStateNode = null;
  let acceptedName = false;
  while (!acceptedName && fiber) {
    firstParentOfNodeWithName = o(fiber);
    fiberWithStateNode = s(firstParentOfNodeWithName);
    acceptedName = activeTraceItems.includes(
      i(firstParentOfNodeWithName) ?? ""
    );
    if (!acceptedName) {
      fiber = l(fiber);
    }
  }
  if (fiberWithStateNode && firstParentOfNodeWithName) {
    return {
      stateNode: fiberWithStateNode,
      nameFiber: firstParentOfNodeWithName
    };
  }
  return {
    stateNode: null,
    nameFiber: null
  };
};
var filterInvisibleNodes = (nodes) => {
  return nodes.filter(
    (item) => item.element.offsetWidth > 0 && item.element.offsetHeight > 0
  );
};
var getUniqueNodes = (nodes) => {
  const uniques = [];
  nodes.forEach((node) => {
    const isElementExist = uniques.find(
      (item) => item.element === node.element && item.name === node.name
    );
    if (!isElementExist) {
      uniques.push(node);
    }
  });
  return uniques;
};
var traverseDom = (node, activeTraceItems) => {
  var _a;
  if (!node) {
    return [];
  }
  const items = [];
  const fiber = F(node);
  const targetFiber = selectFiber(fiber, activeTraceItems);
  if (targetFiber.nameFiber) {
    const [element] = getFirstHTMLElementFromFiber(targetFiber.nameFiber);
    const name = i(targetFiber.nameFiber);
    if (element && name) {
      items.push({
        element,
        name
      });
    }
  }
  for (let i2 = 0; i2 < (((_a = node == null ? void 0 : node.children) == null ? void 0 : _a.length) ?? 0); i2++) {
    items.push(
      ...traverseDom(node.children[i2], activeTraceItems)
    );
  }
  return items;
};
var useSelector = (active) => {
  const { httpUrl } = import_react4.default.useContext(DevToolsContext);
  const [selectableElements, setSelectableElements] = import_react4.default.useState([]);
  const fetchTraceItems = import_react4.default.useCallback(async () => {
    const response = await fetch(`${httpUrl}/api/unique-trace-items`);
    const data = await response.json();
    return data.data;
  }, [httpUrl]);
  const prepareSelector = import_react4.default.useCallback(async () => {
    const fetchedTraceItems = await fetchTraceItems();
    const traversedNodes = traverseDom(document.body, fetchedTraceItems);
    const filterInvisible = filterInvisibleNodes(traversedNodes);
    const uniqueNodes = getUniqueNodes(filterInvisible);
    setSelectableElements(uniqueNodes);
  }, [fetchTraceItems]);
  import_react4.default.useEffect(() => {
    if (active) {
      prepareSelector();
    }
  }, [active, prepareSelector]);
  return {
    selectableElements
  };
};
var ApplyStyles = ({ children }) => {
  import_react5.default.useEffect(() => {
    const element = document.createElement("style");
    element.innerHTML = children;
    document.head.appendChild(element);
    return () => {
      document.head.removeChild(element);
    };
  }, [children]);
  return null;
};
var SelectorButtonIcon = (props) => import_react7.default.createElement(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    ...props
  },
  import_react7.default.createElement(
    "path",
    {
      fill: "#0FBDBD",
      fillRule: "evenodd",
      d: "M9 1a1 1 0 0 0-2 0v2.1A5.006 5.006 0 0 0 3.1 7H1a1 1 0 0 0 0 2h2.1A5.006 5.006 0 0 0 7 12.9V15a1 1 0 1 0 2 0v-2.1A5.006 5.006 0 0 0 12.9 9H15a1 1 0 1 0 0-2h-2.1A5.006 5.006 0 0 0 9 3.1V1Zm2 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
      clipRule: "evenodd"
    }
  )
);
var SelectorIcon = (props) => import_react7.default.createElement(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    ...props
  },
  import_react7.default.createElement(
    "path",
    {
      fill: "#14141F",
      fillRule: "evenodd",
      d: "M9 1a1 1 0 0 0-2 0v2.1A5.006 5.006 0 0 0 3.1 7H1a1 1 0 0 0 0 2h2.1A5.006 5.006 0 0 0 7 12.9V15a1 1 0 1 0 2 0v-2.1A5.006 5.006 0 0 0 12.9 9H15a1 1 0 1 0 0-2h-2.1A5.006 5.006 0 0 0 9 3.1V1Zm2 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
      clipRule: "evenodd"
    }
  )
);
var MIN_SIZE = 22;
var getPosition = (element, document2) => {
  const { top, left, width, height } = element.getBoundingClientRect();
  const { scrollLeft, scrollTop } = document2.documentElement;
  const positionLeft = left + scrollLeft - Math.max(0, MIN_SIZE - width) / 2;
  const positionTop = top + scrollTop - Math.max(0, MIN_SIZE - height) / 2;
  return {
    left: positionLeft,
    top: positionTop,
    width: Math.max(MIN_SIZE, width),
    height: Math.max(MIN_SIZE, height)
  };
};
var SelectableElement = ({
  element,
  name,
  onSelect
}) => {
  const [position] = import_react6.default.useState(() => getPosition(element, document));
  const elementRef = import_react6.default.useRef(null);
  import_react6.default.useEffect(() => {
    const onScroll = debounce_default(
      () => {
        var _a;
        const nextPos = getPosition(element, document);
        ["left", "top", "width", "height"].forEach((prop) => {
          var _a2;
          (_a2 = elementRef.current) == null ? void 0 : _a2.style.setProperty(prop, `${nextPos[prop]}px`);
        });
        (_a = elementRef.current) == null ? void 0 : _a.style.setProperty("opacity", "1");
      },
      200,
      {
        leading: false,
        trailing: true
      }
    );
    const opacityOnScroll = debounce_default(
      () => {
        var _a;
        (_a = elementRef.current) == null ? void 0 : _a.style.setProperty("opacity", "0");
      },
      200,
      {
        leading: true,
        trailing: false
      }
    );
    document.addEventListener("scroll", onScroll);
    document.addEventListener("scroll", opacityOnScroll);
    return () => {
      document.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", opacityOnScroll);
    };
  }, [element]);
  const placement = import_react6.default.useMemo(() => {
    const tooltipBaseSize = { width: 22, height: 22 };
    const nameWidth = name.length * 7.5;
    const tooltipSize = {
      width: tooltipBaseSize.width + nameWidth,
      height: tooltipBaseSize.height
    };
    const gap = 4;
    if (position.top - tooltipSize.height > 0 && position.left + tooltipSize.width < window.innerWidth && position.width > tooltipSize.width) {
      return { left: gap / 2, top: tooltipSize.height * -1 - gap };
    }
    if (position.height >= tooltipSize.height * 1.5 && position.width >= tooltipSize.width * 1.5) {
      return { left: 0 + gap, top: 0 + gap };
    }
    if (position.left - tooltipSize.width > 0) {
      return { right: position.width + gap, top: 0 - 1 };
    }
    if (position.left + position.width + tooltipSize.width < window.innerWidth) {
      return { left: position.width + gap, top: 0 - 1 };
    }
    if (position.top + position.height + tooltipSize.height < document.documentElement.scrollHeight) {
      return { left: 0 - 1, top: position.height + gap };
    }
    return { left: 0, top: 0 };
  }, [position, name.length]);
  return import_react6.default.createElement(
    "button",
    {
      type: "button",
      className: "selector-xray-box",
      onClick: (event) => {
        event == null ? void 0 : event.preventDefault();
        event == null ? void 0 : event.stopPropagation();
        onSelect(name);
      },
      ref: elementRef,
      style: {
        position: "absolute",
        ...position
      }
    },
    import_react6.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          ...placement
        },
        className: "selector-xray-info"
      },
      import_react6.default.createElement("span", { className: "selector-xray-info-icon" }, import_react6.default.createElement(
        SelectorIcon,
        {
          width: 12,
          height: 12,
          style: { pointerEvents: "none" }
        }
      )),
      import_react6.default.createElement("span", { className: "selector-xray-info-title" }, ` ${name}`)
    )
  );
};
var SelectableElements = ({
  elements,
  onSelect
}) => {
  const [selectorBoxRoot, setSelectorBoxRoot] = import_react6.default.useState(null);
  import_react6.default.useEffect(() => {
    if (!selectorBoxRoot) {
      const element = document.createElement("div");
      element.id = "selector-box-root";
      document.body.appendChild(element);
      setSelectorBoxRoot(element);
      return () => {
        document.body.removeChild(element);
        setSelectorBoxRoot(null);
      };
    }
    return () => 0;
  }, []);
  if (!selectorBoxRoot)
    return null;
  return import_react6.default.createElement(import_react6.default.Fragment, null, (0, import_react_dom.createPortal)(
    elements.map((element, idx) => import_react6.default.createElement(
      SelectableElement,
      {
        key: `selector-element-${idx}-${element.name}`,
        ...element,
        onSelect
      }
    )),
    selectorBoxRoot
  ), import_react6.default.createElement(
    ApplyStyles,
    null,
    /* css */
    `
          .selector-xray-box {
            display: flex;
            margin: 0;
            padding: 0;
            appearance: none;
            z-index: 9999;
            border: 2px dashed #47EBEB;
            border-radius: 6px;
            background: rgba(71, 235, 235, 0.01);
            transition: opacity 0.2s ease-in-out;
            cursor: crosshair;
          }
        
          .selector-xray-info {
            display: flex;
            justify-content: center;
            align-items: center;
      
            z-index: 10;
      
            padding: 3px 0;
            min-width: 22px;
            height: 22px;
      
            color: #14141F;
            background: #47EBEB;
      
            font-size: 12px;
            line-height: 16px;
            font-family: monospace;
            border-radius: 11px;
          }
      
          .selector-xray-info-icon {
            display: flex;
            min-width: 22px;
            justify-content: center;
            align-items: center;
            flex-shrink: 0;
          }
      
          .selector-xray-info-title {
            display: block;
            max-width: 0;
            overflow: hidden;
            transition-property: max-width, padding-right;
            transition-duration: 0.2s;
            transition-timing-function: ease-in-out;
            transition-delay: 0.1s;
          }
      
          .selector-xray-box:hover .selector-xray-info-title {
            max-width: 200px;
            padding-right: 8px;
          }
          .selector-xray-box:hover .selector-xray-info-title {
            z-index: 90;
          }
        `
  ));
};
var DevtoolsSelector = ({
  active,
  setActive,
  onHighlight,
  icon,
  style
}) => {
  const { selectableElements } = useSelector(active);
  const onSelect = (name) => {
    onHighlight(name);
    setActive(false);
  };
  return import_react3.default.createElement("div", { style }, import_react3.default.createElement(
    "div",
    {
      role: "button",
      title: "Element Selector",
      className: "refine-devtools-selector-button",
      onClick: (event) => {
        var _a;
        event.preventDefault();
        event.stopPropagation();
        (_a = document == null ? void 0 : document.activeElement) == null ? void 0 : _a.blur();
        setActive((active2) => !active2);
      }
    },
    icon
  ), active && import_react3.default.createElement(SelectableElements, { elements: selectableElements, onSelect }), import_react3.default.createElement(
    ApplyStyles,
    null,
    /* css */
    `
        .refine-devtools-selector-button {
          padding: 0;
          margin: 0;
          height: 100%;
          width: 100%;
          transform: rotate(0deg);
          transition: transform 0.2s ease-in-out;
          line-height: 1;
        }

        .refine-devtools-selector-button:hover {
          transform: rotate(180deg);
        }
    `
  ));
};
var DevtoolsIcon = (props) => React6.createElement(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    width: 157,
    height: 25,
    viewBox: "0 0 157 25",
    fill: "none",
    ...props
  },
  React6.createElement("g", null, React6.createElement("path", { fill: "#1D1E30", d: "M17 1h123v24H17z" }), React6.createElement(
    "path",
    {
      fill: "#1D1E30",
      d: "M6.265 9.205A12 12 0 0 1 17.649 1H25v24H1L6.265 9.205ZM150.735 9.205A12 12 0 0 0 139.351 1H132v24h24l-5.265-15.795Z"
    }
  ), React6.createElement(
    "path",
    {
      fill: "currentColor",
      d: "M25 14.333A1.333 1.333 0 1 1 25 17a1.333 1.333 0 0 1 0-2.667Z"
    }
  ), React6.createElement(
    "path",
    {
      fill: "currentColor",
      fillRule: "evenodd",
      d: "M23.211 20.578a4 4 0 0 0 3.578 0l4-2A4 4 0 0 0 33 15v-4a4 4 0 0 0-2.211-3.578l-4-2a4 4 0 0 0-3.578 0l-4 2A4 4 0 0 0 17 11v4a4 4 0 0 0 2.211 3.578l4 2Zm-.878-4.911a2.667 2.667 0 0 0 5.334 0v-5.334a2.667 2.667 0 0 0-5.334 0v5.334Z",
      clipRule: "evenodd"
    }
  ), React6.createElement(
    "path",
    {
      fill: "#CFD7E2",
      d: "M42.152 17a.287.287 0 0 1-.192-.072.287.287 0 0 1-.072-.192V9.032c0-.072.024-.132.072-.18a.264.264 0 0 1 .192-.084h4.2c.288 0 .56.056.816.168a2.135 2.135 0 0 1 1.14 1.128c.112.256.168.532.168.828v3.984c0 .296-.056.572-.168.828a2.135 2.135 0 0 1-1.14 1.128 2.014 2.014 0 0 1-.816.168h-4.2Zm1.38-1.644h2.82a.455.455 0 0 0 .336-.132.497.497 0 0 0 .132-.348v-3.984a.455.455 0 0 0-.132-.336.436.436 0 0 0-.336-.144h-2.82v4.944Zm13.18-5.196a.244.244 0 0 1-.253.252h-4.44v1.656h4.02c.072 0 .132.024.18.072a.227.227 0 0 1 .084.18v1.128a.264.264 0 0 1-.084.192.244.244 0 0 1-.18.072h-4.02v1.644h4.44c.072 0 .132.028.18.084a.244.244 0 0 1 .072.18v1.116a.287.287 0 0 1-.072.192.244.244 0 0 1-.18.072h-5.832a.244.244 0 0 1-.18-.072.287.287 0 0 1-.072-.192V9.032c0-.072.024-.132.072-.18a.227.227 0 0 1 .18-.084h5.832c.072 0 .132.028.18.084a.244.244 0 0 1 .072.18v1.128ZM63.014 17h-2.232a.387.387 0 0 1-.216-.072.356.356 0 0 1-.144-.168l-1.716-4.296a.853.853 0 0 1-.072-.24 1.783 1.783 0 0 1-.024-.264V9.032c0-.072.024-.132.072-.18a.227.227 0 0 1 .18-.084h1.128c.072 0 .132.028.18.084a.227.227 0 0 1 .084.18v2.616c0 .072.008.156.024.252s.04.176.072.24l1.284 3.216h.528l1.284-3.216a.853.853 0 0 0 .072-.24c.016-.096.024-.18.024-.252V9.032c0-.072.024-.132.072-.18a.264.264 0 0 1 .192-.084h1.128c.072 0 .132.028.18.084a.244.244 0 0 1 .072.18v2.928c0 .072-.008.16-.024.264a.853.853 0 0 1-.072.24l-1.716 4.296a.356.356 0 0 1-.144.168.387.387 0 0 1-.216.072ZM73.29 8.768c.072 0 .132.028.18.084a.227.227 0 0 1 .084.18v1.128a.227.227 0 0 1-.084.18.244.244 0 0 1-.18.072h-2.208v6.324a.264.264 0 0 1-.084.192.244.244 0 0 1-.18.072H69.69a.244.244 0 0 1-.18-.072.287.287 0 0 1-.072-.192v-6.324H67.23a.287.287 0 0 1-.192-.072.244.244 0 0 1-.072-.18V9.032c0-.072.024-.132.072-.18a.264.264 0 0 1 .192-.084h6.06Zm6.507.012c.296 0 .572.056.828.168a2.171 2.171 0 0 1 1.128 1.128c.112.256.168.528.168.816v3.996c0 .288-.056.56-.168.816a2.171 2.171 0 0 1-1.128 1.128 2.043 2.043 0 0 1-.828.168h-2.34c-.296 0-.572-.056-.828-.168a2.171 2.171 0 0 1-1.128-1.128 2.014 2.014 0 0 1-.168-.816v-3.996c0-.288.056-.56.168-.816a2.171 2.171 0 0 1 1.128-1.128c.256-.112.532-.168.828-.168h2.34Zm.48 2.112a.436.436 0 0 0-.144-.336.455.455 0 0 0-.336-.132h-2.34a.497.497 0 0 0-.348.132.455.455 0 0 0-.132.336v3.996c0 .136.044.248.132.336a.497.497 0 0 0 .348.132h2.34a.455.455 0 0 0 .336-.132.436.436 0 0 0 .144-.336v-3.996Zm7.888-2.112c.295 0 .572.056.828.168a2.171 2.171 0 0 1 1.128 1.128c.112.256.168.528.168.816v3.996c0 .288-.056.56-.168.816a2.171 2.171 0 0 1-1.128 1.128 2.043 2.043 0 0 1-.828.168h-2.34c-.297 0-.573-.056-.829-.168a2.171 2.171 0 0 1-1.127-1.128 2.014 2.014 0 0 1-.168-.816v-3.996c0-.288.056-.56.168-.816a2.171 2.171 0 0 1 1.127-1.128c.257-.112.532-.168.829-.168h2.34Zm.48 2.112a.436.436 0 0 0-.144-.336.455.455 0 0 0-.337-.132h-2.34a.497.497 0 0 0-.347.132.455.455 0 0 0-.133.336v3.996c0 .136.044.248.133.336a.497.497 0 0 0 .347.132h2.34a.455.455 0 0 0 .337-.132.436.436 0 0 0 .143-.336v-3.996ZM98.294 17H92.68a.287.287 0 0 1-.192-.072.287.287 0 0 1-.072-.192V9.032c0-.072.024-.132.072-.18a.264.264 0 0 1 .192-.084h1.116c.072 0 .132.028.18.084a.227.227 0 0 1 .084.18v6.324h4.236c.072 0 .132.028.18.084a.244.244 0 0 1 .072.18v1.116a.287.287 0 0 1-.072.192.244.244 0 0 1-.18.072Zm7.336-5.76a.287.287 0 0 1-.192-.072.287.287 0 0 1-.072-.192v-.084a.455.455 0 0 0-.132-.336.436.436 0 0 0-.336-.144h-2.352a.46.46 0 0 0-.336.144.455.455 0 0 0-.132.336v.696c0 .136.044.252.132.348a.482.482 0 0 0 .336.132h2.352c.288 0 .56.056.816.168a2.171 2.171 0 0 1 1.128 1.128c.112.256.168.528.168.816v.696c0 .296-.056.572-.168.828a2.171 2.171 0 0 1-1.128 1.128 2.014 2.014 0 0 1-.816.168h-2.352c-.288 0-.56-.056-.816-.168a2.171 2.171 0 0 1-1.128-1.128 2.043 2.043 0 0 1-.168-.828v-.084c0-.072.024-.132.072-.18a.264.264 0 0 1 .192-.084h1.116c.072 0 .132.028.18.084a.227.227 0 0 1 .084.18v.084c0 .136.044.252.132.348a.482.482 0 0 0 .336.132h2.352a.455.455 0 0 0 .336-.132.497.497 0 0 0 .132-.348v-.696a.455.455 0 0 0-.132-.336.455.455 0 0 0-.336-.132h-2.352c-.288 0-.56-.056-.816-.168a2.171 2.171 0 0 1-1.128-1.128 2.099 2.099 0 0 1-.168-.828v-.696c0-.296.056-.572.168-.828a2.171 2.171 0 0 1 1.128-1.128c.256-.112.528-.168.816-.168h2.352c.288 0 .56.056.816.168a2.171 2.171 0 0 1 1.128 1.128c.112.256.168.532.168.828v.084a.287.287 0 0 1-.072.192.244.244 0 0 1-.18.072h-1.128Z"
    }
  ))
);
var DevtoolsPin = ({
  onClick,
  onSelectorHighlight,
  selectorActive,
  setSelectorActive
}) => {
  return import_react2.default.createElement("div", { role: "button", className: "devtools-selector-pin-box", onClick }, import_react2.default.createElement(DevtoolsIcon, null), import_react2.default.createElement(
    DevtoolsSelector,
    {
      style: {
        position: "absolute",
        top: 5,
        right: 18,
        width: "16px",
        height: "16px"
      },
      icon: import_react2.default.createElement(
        SelectorButtonIcon,
        {
          width: 16,
          height: 16,
          style: { pointerEvents: "none" }
        }
      ),
      onHighlight: onSelectorHighlight,
      active: selectorActive,
      setActive: setSelectorActive
    }
  ), import_react2.default.createElement(
    ApplyStyles,
    null,
    /* css */
    `
            .devtools-selector-pin-box {
              z-index: 9999;
              position: relative;
              user-select: none;
              -webkit-user-select: none;
              background: none;
              border: none;
              padding: 0;
              margin: 0;
              appearance: none;
              padding-right: 1px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              color: #6C7793;
              transition: color 0.1s ease-in-out;
            }

            .devtools-selector-pin-box:hover {
              color: #0FBDBD;
            }
          `
  ));
};
var getPanelToggleTransforms = (visible) => {
  return visible ? "scaleX(1) translateY(0)" : "scaleX(0) translateY(25vw)";
};
var SIZE = 50;
var BUFFER = 10;
var PREFERRED_DEFAULT_WIDTH = () => typeof window !== "undefined" ? window.innerWidth * 0.7 : 1440 * 0.7;
var PREFERRED_DEFAULT_HEIGHT = () => typeof window !== "undefined" ? window.innerHeight * 0.7 : 900 * 0.7;
var MIN_PANEL_WIDTH = 640;
var MIN_PANEL_HEIGHT = 360;
var getPanelPosition = (placement) => {
  switch (placement) {
    case "left":
      return {
        left: `calc(${SIZE}px + ${BUFFER}px)`,
        top: "50%",
        transform: "translateY(-50%)"
      };
    case "right":
      return {
        right: `calc(${SIZE}px + ${BUFFER}px)`,
        top: "50%",
        transform: "translateY(-50%)"
      };
    case "top":
      return {
        left: "50%",
        top: `calc(${SIZE}px + ${BUFFER}px)`,
        transform: "translateX(-50%)"
      };
    case "bottom":
      return {
        left: "50%",
        bottom: `calc(${SIZE}px + ${BUFFER}px)`,
        transform: "translateX(-50%)"
      };
  }
};
var getMaxPanelWidth = (placement) => {
  switch (placement) {
    case "left":
    case "right":
      return -BUFFER - SIZE - BUFFER + (typeof window !== "undefined" ? window.innerWidth : 1440) - BUFFER;
    case "top":
    case "bottom":
      return -BUFFER + (typeof window !== "undefined" ? window.innerWidth : 1440) - BUFFER;
  }
};
var getMaxPanelHeight = (placement) => {
  switch (placement) {
    case "left":
    case "right":
      return -BUFFER + (typeof window !== "undefined" ? window.innerHeight : 900) - BUFFER;
    case "top":
    case "bottom":
      return -BUFFER - SIZE - BUFFER + (typeof window !== "undefined" ? window.innerHeight : 900) - BUFFER;
  }
};
var getDefaultPanelSize = (placement, preferredSize) => {
  const defaultPreferred = {
    width: PREFERRED_DEFAULT_WIDTH(),
    height: PREFERRED_DEFAULT_HEIGHT()
  };
  const maxPanelWidth = getMaxPanelWidth(placement);
  const maxPanelHeight = getMaxPanelHeight(placement);
  const width = Math.min(
    maxPanelWidth,
    (preferredSize ?? defaultPreferred).width
  );
  const height = Math.min(
    maxPanelHeight,
    (preferredSize ?? defaultPreferred).height
  );
  return {
    width,
    height
  };
};
var roundToEven = (num) => {
  const rounded = Math.round(num);
  return rounded % 2 === 0 ? rounded : rounded + 1;
};
var ResizeHandleIcon = (props) => import_react9.default.createElement(
  "svg",
  {
    width: 10,
    height: 26,
    viewBox: "0 0 10 26",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    ...props
  },
  import_react9.default.createElement("rect", { x: 0.5, y: 0.5, width: 9, height: 25, rx: 4.5, fill: "#1D1E30" }),
  import_react9.default.createElement(
    "path",
    {
      d: "M7 5C7 6.10457 6.10457 7 5 7C3.89543 7 3 6.10457 3 5C3 3.89543 3.89543 3 5 3C6.10457 3 7 3.89543 7 5Z",
      fill: "#303450"
    }
  ),
  import_react9.default.createElement(
    "path",
    {
      d: "M7 13C7 14.1046 6.10457 15 5 15C3.89543 15 3 14.1046 3 13C3 11.8954 3.89543 11 5 11C6.10457 11 7 11.8954 7 13Z",
      fill: "#303450"
    }
  ),
  import_react9.default.createElement(
    "path",
    {
      d: "M7 21C7 22.1046 6.10457 23 5 23C3.89543 23 3 22.1046 3 21C3 19.8954 3.89543 19 5 19C6.10457 19 7 19.8954 7 21Z",
      fill: "#303450"
    }
  ),
  import_react9.default.createElement("rect", { x: 0.5, y: 0.5, width: 9, height: 25, rx: 4.5, stroke: "#303450" })
);
var ResizablePane = ({ placement, visible, children }) => {
  const [hover, setHover] = import_react8.default.useState(false);
  const [resizing, setResizing] = import_react8.default.useState(null);
  const [resizePosition, setResizePosition] = import_react8.default.useState(null);
  const [panelSize, setPanelSize] = import_react8.default.useState(() => {
    const defaultSize = getDefaultPanelSize(placement);
    return {
      width: roundToEven(defaultSize.width),
      height: roundToEven(defaultSize.height)
    };
  });
  import_react8.default.useEffect(() => {
    const handleResize = () => {
      setPanelSize((p2) => {
        const defaultSize = getDefaultPanelSize(placement, p2);
        return {
          width: roundToEven(defaultSize.width),
          height: roundToEven(defaultSize.height)
        };
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [placement]);
  import_react8.default.useEffect(() => {
    const handleMouseUp = () => {
      setResizing(null);
    };
    if (resizing !== null) {
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
    return;
  }, [resizing]);
  import_react8.default.useEffect(() => {
    const currentCursor = document.body.style.cursor;
    if (resizing == null ? void 0 : resizing.includes("x")) {
      document.body.style.cursor = "col-resize";
    } else if (resizing == null ? void 0 : resizing.includes("y")) {
      document.body.style.cursor = "row-resize";
    }
    return () => {
      document.body.style.cursor = currentCursor;
    };
  }, [resizing]);
  import_react8.default.useEffect(() => {
    const handleMouseMove = (e) => {
      if ((resizing == null ? void 0 : resizing[1]) === "x") {
        const diff = e.clientX - ((resizePosition == null ? void 0 : resizePosition.x) ?? e.clientX);
        const newWidth = panelSize.width + (resizing === "lx" ? -diff : diff) * 2;
        setPanelSize((p2) => ({
          ...p2,
          width: roundToEven(
            Math.min(
              getMaxPanelWidth(placement),
              Math.max(MIN_PANEL_WIDTH, newWidth)
            )
          )
        }));
      } else if ((resizing == null ? void 0 : resizing[1]) === "y") {
        const diff = e.clientY - ((resizePosition == null ? void 0 : resizePosition.y) ?? e.clientY);
        const newHeight = panelSize.height + (resizing === "ty" ? -diff : diff) * 1;
        setPanelSize((p2) => ({
          ...p2,
          height: roundToEven(
            Math.min(
              getMaxPanelHeight(placement),
              Math.max(MIN_PANEL_HEIGHT, newHeight)
            )
          )
        }));
      }
    };
    if (resizing !== null) {
      window.addEventListener("mousemove", handleMouseMove);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
      };
    }
    return;
  }, [resizing, placement]);
  return import_react8.default.createElement(
    "div",
    {
      style: {
        position: "absolute",
        borderRadius: "8px",
        boxShadow: "0 0 10px rgba(0, 0, 0, 0.5)",
        border: "1px solid rgba(0, 0, 0, 0.5)",
        transitionProperty: "transform, opacity",
        transitionTimingFunction: "ease-in-out",
        transitionDuration: "0.2s",
        ...getPanelPosition(placement),
        opacity: visible ? 1 : 0,
        transform: `${getPanelPosition(placement).transform} ${getPanelToggleTransforms(visible ?? false)}`,
        ...panelSize
      },
      onMouseEnter: () => {
        setHover(true);
      },
      onMouseLeave: () => {
        setHover(false);
      }
    },
    children({ resizing }),
    import_react8.default.createElement(import_react8.default.Fragment, null, import_react8.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: 0,
          top: "50%",
          width: "10px",
          height: "26px",
          transform: "translateY(-13px) translateX(-5px)",
          cursor: "col-resize",
          transition: "opacity ease-in-out 0.2s",
          pointerEvents: hover || resizing ? "auto" : "none",
          opacity: hover || resizing ? 1 : 0
        },
        onMouseDown: (event) => {
          setResizing("lx");
          setResizePosition({
            x: event.clientX,
            y: event.clientY
          });
          event.preventDefault();
        }
      },
      import_react8.default.createElement(ResizeHandleIcon, null)
    ), import_react8.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          right: 0,
          top: "50%",
          width: "10px",
          height: "26px",
          transform: "translateY(-13px) translateX(5px)",
          cursor: "col-resize",
          transition: "opacity ease-in-out 0.2s",
          pointerEvents: hover || resizing ? "auto" : "none",
          opacity: hover || resizing ? 1 : 0
        },
        onMouseDown: (event) => {
          setResizing("rx");
          setResizePosition({
            x: event.clientX,
            y: event.clientY
          });
          event.preventDefault();
        }
      },
      import_react8.default.createElement(ResizeHandleIcon, null)
    ), import_react8.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: "50%",
          top: 0,
          width: "26px",
          height: "10px",
          transform: "translateY(-5px) translateX(-13px)",
          cursor: "row-resize",
          transition: "opacity ease-in-out 0.2s",
          pointerEvents: hover || resizing ? "auto" : "none",
          opacity: hover || resizing ? 1 : 0
        },
        onMouseDown: (event) => {
          setResizing("ty");
          setResizePosition({
            x: event.clientX,
            y: event.clientY
          });
          event.preventDefault();
        }
      },
      import_react8.default.createElement(
        ResizeHandleIcon,
        {
          style: {
            transform: "rotate(90deg)",
            transformOrigin: "13px 13px"
          }
        }
      )
    ), import_react8.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: "50%",
          bottom: 0,
          width: "26px",
          height: "10px",
          transform: "translateY(5px) translateX(-13px)",
          cursor: "row-resize",
          transition: "opacity ease-in-out 0.2s",
          pointerEvents: hover || resizing ? "auto" : "none",
          opacity: hover || resizing ? 1 : 0
        },
        onMouseDown: (event) => {
          setResizing("by");
          setResizePosition({
            x: event.clientX,
            y: event.clientY
          });
          event.preventDefault();
        }
      },
      import_react8.default.createElement(
        ResizeHandleIcon,
        {
          style: {
            transform: "rotate(90deg)",
            transformOrigin: "13px 13px"
          }
        }
      )
    ))
  );
};
var MAX_IFRAME_WAIT_TIME = 1500;
var DevtoolsPanel = false ? () => null : () => {
  const [browser, setBrowser] = import_react.default.useState(false);
  const [visible, setVisible] = import_react.default.useState(false);
  const [placement] = import_react.default.useState("bottom");
  const { httpUrl, ws } = import_react.default.useContext(DevToolsContext);
  const [width, setWidth] = import_react.default.useState(0);
  const [selectorActive, setSelectorActive] = import_react.default.useState(false);
  const [iframeStatus, setIframeStatus] = import_react.default.useState("loading");
  const onSelectorHighlight = import_react.default.useCallback(
    (name) => {
      if (ws) {
        send(ws, DevtoolsEvent.DEVTOOLS_HIGHLIGHT_IN_MONITOR, {
          name
        });
      }
      setVisible(true);
    },
    [ws]
  );
  import_react.default.useEffect(() => {
    if (selectorActive) {
      setVisible(false);
    }
  }, [selectorActive]);
  import_react.default.useEffect(() => {
    if (typeof window !== "undefined") {
      setBrowser(true);
    }
  }, []);
  import_react.default.useEffect(() => {
    if (browser) {
      setWidth(window.innerWidth);
      const onResize = () => {
        setWidth(window.innerWidth);
      };
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
      };
    }
    return () => void 0;
  }, [browser]);
  import_react.default.useEffect(() => {
    if (iframeStatus !== "loaded") {
      const onMessage = (event) => {
        if (event.data.type === "refine-devtools-iframe-loaded") {
          setIframeStatus("loaded");
        }
      };
      window.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("message", onMessage);
      };
    }
    return () => 0;
  }, []);
  import_react.default.useEffect(() => {
    let timeout;
    if (iframeStatus === "loading") {
      timeout = window.setTimeout(() => {
        setIframeStatus("failed");
        if (timeout) {
          clearInterval(timeout);
        }
      }, MAX_IFRAME_WAIT_TIME);
    }
    return () => {
      if (typeof timeout !== "undefined") {
        clearInterval(timeout);
      }
    };
  }, [iframeStatus]);
  if (!browser) {
    return null;
  }
  return import_react.default.createElement(
    "div",
    {
      style: {
        position: "fixed",
        left: `${Math.round(width / 2)}px`,
        transform: "translateX(-50%)",
        bottom: 0,
        zIndex: 99999
      }
    },
    import_react.default.createElement(
      DevtoolsPin,
      {
        onClick: () => {
          setVisible((v) => !v);
          setSelectorActive(false);
        },
        onSelectorHighlight,
        selectorActive,
        setSelectorActive
      }
    ),
    import_react.default.createElement(ResizablePane, { visible, placement }, ({ resizing }) => import_react.default.createElement(
      "iframe",
      {
        allow: "clipboard-write;",
        src: httpUrl,
        srcDoc: httpUrl ? iframeStatus === "failed" ? failedConnectionContent : void 0 : missingUrlContent,
        style: {
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: "7px",
          pointerEvents: resizing ? "none" : "auto",
          background: "#14141F"
        }
      }
    ))
  );
};
var missingUrlContent = `
      <html style="height:100%;padding:0;margin:0;background:#14141F;">
        <body style="background:#14141F;display:flex;justify-content:center;height:100%;padding:24px;margin:0;align-items:center;box-sizing:border-box;">
          <h1 style="font-family:ui-monospace,monospace;font-weight:400;color:#CFD7E2;text-align:center;font-size:24px;">Could not connect to the devtools server.</h1>
        </body>
      </html>
      `;
var failedConnectionContent = `
      <html style="height:100%;padding:0;margin:0;background:#14141F;">
        <body style="background:#14141F;display:flex;flex-direction:column;justify-content:center;height:100%;padding:24px;margin:0;align-items:center;box-sizing:border-box;">
          <h1 style="max-width:480px;min-width:480px;font-family:ui-monospace,monospace;font-weight:400;color:#CFD7E2;text-align:left;font-size:24px;margin-bottom:12px;line-height:24px;">Devtools Server is unreachable.</h1>
          <p style="max-width:480px;font-family:ui-monospace,monospace;font-weight:400;color:#6C7793;text-align:left;font-size:16px;line-height:32px;">Please make sure Refine Devtools is running and <code style="background:#303450;color:#A3ADC2;padding:3px 6px;border-radius:4px;">&lt;DevtoolsProvider /&gt;</code> has valid <code style="background:#303450;color:#A3ADC2;padding:3px 6px;border-radius:4px;">url</code> prop. Environment variables may not always be available in browser depending on your project setup.</p>
        </body>
      </html>
      `;
var DEFAULT_DEVTOOLS_PORT = 5001;
var getDevtoolsUrlFromEnv = () => {
  const PORT_FROM_ENV = typeof process !== "undefined" && "env" in process ? process.env.REFINE_DEVTOOLS_PORT || process.env.NEXT_PUBLIC_REFINE_DEVTOOLS_PORT || process.env.REACT_APP_REFINE_DEVTOOLS_PORT : typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.REFINE_DEVTOOLS_PORT || import.meta.env.VITE_REFINE_DEVTOOLS_PORT : null;
  const port = PORT_FROM_ENV || DEFAULT_DEVTOOLS_PORT;
  return [`http://localhost:${port}`, `ws://localhost:${port}`];
};
var DevtoolsProvider = false ? ({ children }) => children : ({ children, url = getDevtoolsUrlFromEnv() }) => {
  return import_react10.default.createElement(DevToolsContextProvider, { url }, children);
};
export {
  DevtoolsPanel,
  DevtoolsProvider
};
//# sourceMappingURL=@refinedev_devtools.js.map
