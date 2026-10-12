"use client";
import {
  flattenObjectKeys,
  get_default,
  hasPath_default,
  useForm,
  useGo,
  useInvalidate,
  useModal,
  useParsed,
  useRefineContext,
  useResourceParams,
  useTranslate,
  useUserFriendlyName,
  useWarnAboutChange
} from "./chunk-SYPME2GI.js";
import "./chunk-NWHHQHUP.js";
import {
  useForm as useForm2
} from "./chunk-W5EH4ZZC.js";
import {
  __toESM,
  require_react
} from "./chunk-7W76HJBA.js";

// node_modules/@refinedev/react-hook-form/dist/index.mjs
var import_react = __toESM(require_react(), 1);

// node_modules/lodash-es/_baseHas.js
var objectProto = Object.prototype;
var hasOwnProperty = objectProto.hasOwnProperty;
function baseHas(object, key) {
  return object != null && hasOwnProperty.call(object, key);
}
var baseHas_default = baseHas;

// node_modules/lodash-es/has.js
function has(object, path) {
  return object != null && hasPath_default(object, path, baseHas_default);
}
var has_default = has;

// node_modules/@refinedev/react-hook-form/dist/index.mjs
var import_react2 = __toESM(require_react(), 1);
var import_react3 = __toESM(require_react(), 1);
var import_react4 = __toESM(require_react(), 1);
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var useForm3 = __name(({
  refineCoreProps,
  warnWhenUnsavedChanges: warnWhenUnsavedChangesProp,
  disableServerSideValidation: disableServerSideValidationProp = false,
  ...rest
} = {}) => {
  const { options } = useRefineContext();
  const disableServerSideValidation = (options == null ? void 0 : options.disableServerSideValidation) || disableServerSideValidationProp;
  const translate = useTranslate();
  const { warnWhenUnsavedChanges: warnWhenUnsavedChangesRefine, setWarnWhen } = useWarnAboutChange();
  const warnWhenUnsavedChanges = warnWhenUnsavedChangesProp ?? warnWhenUnsavedChangesRefine;
  const useHookFormResult = useForm2({
    ...rest
  });
  const {
    control,
    watch,
    setValue,
    getValues,
    handleSubmit: handleSubmitReactHookForm,
    setError,
    formState: { dirtyFields }
  } = useHookFormResult;
  const queryDataRef = import_react.default.useRef(void 0);
  const syncedFieldsRef = import_react.default.useRef(/* @__PURE__ */ new Set());
  const mountedFieldsRef = import_react.default.useRef(/* @__PURE__ */ new Set());
  const useFormCoreResult = useForm({
    ...refineCoreProps,
    onMutationError: (error, _variables, _context) => {
      var _a, _b;
      if (disableServerSideValidation) {
        (_a = refineCoreProps == null ? void 0 : refineCoreProps.onMutationError) == null ? void 0 : _a.call(refineCoreProps, error, _variables, _context);
        return;
      }
      const errors = error == null ? void 0 : error.errors;
      for (const key in errors) {
        const isKeyInVariables = Object.keys(
          flattenObjectKeys(_variables)
        ).includes(key);
        if (!isKeyInVariables) {
          continue;
        }
        const fieldError = errors[key];
        let newError = "";
        if (Array.isArray(fieldError)) {
          newError = fieldError.join(" ");
        }
        if (typeof fieldError === "string") {
          newError = fieldError;
        }
        if (typeof fieldError === "boolean" && fieldError) {
          newError = "Field is not valid.";
        }
        if (typeof fieldError === "object" && "key" in fieldError) {
          const translatedMessage = translate(
            fieldError.key,
            fieldError.message
          );
          newError = translatedMessage;
        }
        setError(key, {
          message: newError
        });
      }
      (_b = refineCoreProps == null ? void 0 : refineCoreProps.onMutationError) == null ? void 0 : _b.call(refineCoreProps, error, _variables, _context);
    }
  });
  const { query, onFinish, formLoading, onFinishAutoSave } = useFormCoreResult;
  const getMountedFields = __name(() => {
    var _a;
    const mounted = ((_a = control._names) == null ? void 0 : _a.mount) ?? /* @__PURE__ */ new Set();
    return new Set(mounted);
  }, "getMountedFields");
  const getRegisteredFields = __name(() => {
    const registeredFields = /* @__PURE__ */ new Set();
    const mounted = getMountedFields();
    mounted.forEach((name) => registeredFields.add(name));
    const values = getValues();
    Object.keys(flattenObjectKeys(values)).forEach((path) => {
      registeredFields.add(path);
    });
    return registeredFields;
  }, "getRegisteredFields");
  const applyValuesToFields = __name((fieldNames, data, respectDirty = false) => {
    fieldNames.forEach((path) => {
      if (syncedFieldsRef.current.has(path)) {
        return;
      }
      if (respectDirty && get_default(dirtyFields, path)) {
        syncedFieldsRef.current.add(path);
        return;
      }
      syncedFieldsRef.current.add(path);
      if (has_default(data, path)) {
        setValue(path, get_default(data, path));
      }
    });
  }, "applyValuesToFields");
  (0, import_react.useEffect)(() => {
    var _a;
    const data = (_a = query == null ? void 0 : query.data) == null ? void 0 : _a.data;
    if (!data) {
      queryDataRef.current = void 0;
      syncedFieldsRef.current = /* @__PURE__ */ new Set();
      mountedFieldsRef.current = /* @__PURE__ */ new Set();
      return;
    }
    let isActive = true;
    const applyQueryValues = __name(() => {
      if (!isActive)
        return;
      applyValuesToFields(getRegisteredFields(), data, false);
    }, "applyQueryValues");
    queryDataRef.current = data;
    syncedFieldsRef.current = /* @__PURE__ */ new Set();
    mountedFieldsRef.current = getMountedFields();
    if (typeof queueMicrotask === "function") {
      queueMicrotask(applyQueryValues);
    } else {
      Promise.resolve().then(applyQueryValues);
    }
    return () => {
      isActive = false;
    };
  }, [query == null ? void 0 : query.data, setValue, getValues]);
  (0, import_react.useEffect)(() => {
    const subscription = watch((values, { type }) => {
      if (type === "change") {
        onValuesChange(values);
      }
    });
    return () => subscription.unsubscribe();
  }, [watch]);
  (0, import_react.useEffect)(() => {
    const data = queryDataRef.current;
    if (!data) {
      return;
    }
    const mountedFieldNames = getMountedFields();
    if (!mountedFieldNames.size) {
      return;
    }
    let hasNewField = false;
    mountedFieldNames.forEach((name) => {
      if (!mountedFieldsRef.current.has(name)) {
        hasNewField = true;
      }
    });
    if (!hasNewField) {
      return;
    }
    mountedFieldsRef.current = new Set(mountedFieldNames);
    applyValuesToFields(mountedFieldNames, data, true);
  });
  const onValuesChange = __name((changeValues) => {
    var _a, _b;
    if (warnWhenUnsavedChanges) {
      setWarnWhen(true);
    }
    if ((_a = refineCoreProps == null ? void 0 : refineCoreProps.autoSave) == null ? void 0 : _a.enabled) {
      setWarnWhen(false);
      const onFinishProps = ((_b = refineCoreProps.autoSave) == null ? void 0 : _b.onFinish) ?? ((values) => values);
      return onFinishAutoSave(onFinishProps(changeValues)).catch(
        (error) => error
      );
    }
    return changeValues;
  }, "onValuesChange");
  const handleSubmit = __name((onValid, onInvalid) => async (e) => {
    setWarnWhen(false);
    return handleSubmitReactHookForm(onValid, onInvalid)(e);
  }, "handleSubmit");
  const saveButtonProps = {
    disabled: formLoading,
    onClick: (e) => {
      handleSubmit(
        (v) => onFinish(v).catch(() => {
        }),
        () => false
      )(e);
    }
  };
  return {
    ...useHookFormResult,
    handleSubmit,
    refineCore: useFormCoreResult,
    saveButtonProps
  };
}, "useForm");
var useStepsForm = __name(({
  stepsProps,
  ...rest
} = {}) => {
  const { defaultStep = 0, isBackValidate = false } = stepsProps ?? {};
  const [current, setCurrent] = (0, import_react2.useState)(defaultStep);
  const useHookFormResult = useForm3({
    ...rest
  });
  const {
    trigger,
    getValues,
    setValue,
    formState: { dirtyFields },
    refineCore: { query }
  } = useHookFormResult;
  (0, import_react2.useEffect)(() => {
    var _a;
    const data = (_a = query == null ? void 0 : query.data) == null ? void 0 : _a.data;
    if (!data)
      return;
    const registeredFields = Object.keys(getValues());
    Object.entries(data).forEach(([key, value]) => {
      const name = key;
      if (registeredFields.includes(name)) {
        if (!get_default(dirtyFields, name)) {
          setValue(name, value);
        }
      }
    });
  }, [query == null ? void 0 : query.data, current, setValue, getValues]);
  const go = __name((step) => {
    let targetStep = step;
    if (step < 0) {
      targetStep = 0;
    }
    setCurrent(targetStep);
  }, "go");
  const gotoStep = __name(async (step) => {
    if (step === current) {
      return;
    }
    if (step < current && !isBackValidate) {
      go(step);
      return;
    }
    const isValid = await trigger();
    if (isValid) {
      go(step);
    }
  }, "gotoStep");
  return {
    ...useHookFormResult,
    steps: {
      currentStep: current,
      gotoStep
    }
  };
}, "useStepsForm");
var useModalForm = __name(({
  modalProps,
  refineCoreProps,
  syncWithLocation,
  ...rest
} = {}) => {
  var _a, _b;
  const invalidate = useInvalidate();
  const [initiallySynced, setInitiallySynced] = import_react4.default.useState(false);
  const translate = useTranslate();
  const { resource: resourceProp, action: actionProp } = refineCoreProps ?? {};
  const { resource, identifier } = useResourceParams({
    resource: resourceProp
  });
  const { action: actionFromParams } = useResourceParams({
    resource: resourceProp,
    action: actionProp
  });
  const parsed = useParsed();
  const go = useGo();
  const getUserFriendlyName = useUserFriendlyName();
  const action = actionProp ?? actionFromParams ?? "";
  const syncingId = !(typeof syncWithLocation === "object" && (syncWithLocation == null ? void 0 : syncWithLocation.syncId) === false);
  const syncWithLocationKey = typeof syncWithLocation === "object" && "key" in syncWithLocation ? syncWithLocation.key : resource && action && syncWithLocation ? `modal-${identifier}-${action}` : void 0;
  const {
    defaultVisible = false,
    autoSubmitClose = true,
    autoResetForm = true,
    autoResetFormWhenClose = true
  } = modalProps ?? {};
  const useHookFormResult = useForm3({
    refineCoreProps: {
      ...refineCoreProps,
      meta: {
        ...syncWithLocationKey ? { [syncWithLocationKey]: void 0 } : {},
        ...refineCoreProps == null ? void 0 : refineCoreProps.meta
      }
    },
    ...rest
  });
  const {
    reset,
    refineCore: { onFinish, id, setId, autoSaveProps, query },
    saveButtonProps,
    handleSubmit
  } = useHookFormResult;
  const { visible, show, close } = useModal({
    defaultVisible
  });
  import_react4.default.useEffect(() => {
    var _a2;
    if (!visible || !((_a2 = query == null ? void 0 : query.data) == null ? void 0 : _a2.data))
      return;
    const formData = query.data.data;
    if (!formData)
      return;
    reset(formData, {
      ...!autoResetFormWhenClose && {
        keepDirtyValues: true
      }
    });
  }, [visible, (_a = query == null ? void 0 : query.data) == null ? void 0 : _a.data, autoResetFormWhenClose]);
  import_react4.default.useEffect(() => {
    var _a2, _b2, _c, _d;
    if (initiallySynced === false && syncWithLocationKey) {
      const openStatus = (_b2 = (_a2 = parsed == null ? void 0 : parsed.params) == null ? void 0 : _a2[syncWithLocationKey]) == null ? void 0 : _b2.open;
      if (typeof openStatus === "boolean") {
        if (openStatus) {
          show();
        }
      } else if (typeof openStatus === "string") {
        if (openStatus === "true") {
          show();
        }
      }
      if (syncingId) {
        const idFromParams = (_d = (_c = parsed == null ? void 0 : parsed.params) == null ? void 0 : _c[syncWithLocationKey]) == null ? void 0 : _d.id;
        if (idFromParams) {
          setId == null ? void 0 : setId(idFromParams);
        }
      }
      setInitiallySynced(true);
    }
  }, [syncWithLocationKey, parsed, syncingId, setId]);
  import_react4.default.useEffect(() => {
    var _a2;
    if (initiallySynced === true) {
      if (visible && syncWithLocationKey) {
        go({
          query: {
            [syncWithLocationKey]: {
              ...(_a2 = parsed == null ? void 0 : parsed.params) == null ? void 0 : _a2[syncWithLocationKey],
              open: true,
              ...syncingId && id && { id }
            }
          },
          options: { keepQuery: true },
          type: "replace"
        });
      } else if (syncWithLocationKey && !visible) {
        go({
          query: {
            [syncWithLocationKey]: void 0
          },
          options: { keepQuery: true },
          type: "replace"
        });
      }
    }
  }, [id, visible, show, syncWithLocationKey, syncingId]);
  const submit = __name(async (values) => {
    await onFinish(values);
    if (autoSubmitClose) {
      close();
    }
    if (autoResetForm) {
      reset();
    }
  }, "submit");
  const { warnWhen, setWarnWhen } = useWarnAboutChange();
  const handleClose = (0, import_react3.useCallback)(() => {
    var _a2;
    if (autoSaveProps.status === "success" && ((_a2 = refineCoreProps == null ? void 0 : refineCoreProps.autoSave) == null ? void 0 : _a2.invalidateOnClose)) {
      invalidate({
        id,
        invalidates: refineCoreProps.invalidates || ["list", "many", "detail"],
        dataProviderName: refineCoreProps.dataProviderName,
        resource: identifier
      });
    }
    if (warnWhen) {
      const warnWhenConfirm = window.confirm(
        translate(
          "warnWhenUnsavedChanges",
          "Are you sure you want to leave? You have unsaved changes."
        )
      );
      if (warnWhenConfirm) {
        setWarnWhen(false);
      } else {
        return;
      }
    }
    setId == null ? void 0 : setId(void 0);
    close();
    if (autoResetFormWhenClose) {
      reset();
    }
  }, [warnWhen, autoSaveProps.status]);
  const handleShow = (0, import_react3.useCallback)(
    (showId) => {
      if (typeof showId !== "undefined") {
        setId == null ? void 0 : setId(showId);
      }
      const needsIdToOpen = action === "edit" || action === "clone";
      const hasId = typeof showId !== "undefined" || typeof id !== "undefined";
      if (needsIdToOpen ? hasId : true) {
        show();
      }
    },
    [id, action, setId, show]
  );
  const title = translate(
    `${identifier}.titles.${actionProp}`,
    void 0,
    `${getUserFriendlyName(
      `${actionProp} ${((_b = resource == null ? void 0 : resource.meta) == null ? void 0 : _b.label) ?? identifier}`,
      "singular"
    )}`
  );
  return {
    modal: {
      submit,
      close: handleClose,
      show: handleShow,
      visible,
      title
    },
    ...useHookFormResult,
    saveButtonProps: {
      ...saveButtonProps,
      onClick: (e) => handleSubmit(submit)(e)
    }
  };
}, "useModalForm");
export {
  useForm3 as useForm,
  useModalForm,
  useStepsForm
};
//# sourceMappingURL=@refinedev_react-hook-form.js.map
