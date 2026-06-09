import { Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import routerProvider, {
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import "./App.css";
import { appResources } from "./constants/resources";
import { ErrorComponent } from "./components/refine-ui/layout/error-component";
import { Layout } from "./components/refine-ui/layout/layout";
import { Toaster } from "./components/refine-ui/notification/toaster";
import { useNotificationProvider } from "./components/refine-ui/notification/use-notification-provider";
import { ThemeProvider } from "./components/refine-ui/theme/theme-provider";
import { ApprovalQueueList } from "./pages/approvals";
import {
  CategoryCreate,
  CategoryEdit,
  CategoryList,
  CategoryShow,
} from "./pages/categories";
import { DashboardPage } from "./pages/dashboard";
import { DisbursementList } from "./pages/disbursements";
import {
  PaymentCreate,
  PaymentEdit,
  PaymentList,
  PaymentShow,
} from "./pages/payments";
import { StaffCreate, StaffEdit, StaffList, StaffShow } from "./pages/staff";
import { dataProvider } from "./providers/data";

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ThemeProvider>
          <DevtoolsProvider>
            <Refine
              dataProvider={dataProvider}
              notificationProvider={useNotificationProvider()}
              routerProvider={routerProvider}
              resources={appResources.map((resource) => ({
                name: resource.name,
                list: resource.list,
                create: resource.create,
                edit: resource.edit,
                show: resource.show,
                meta: {
                  label: resource.label,
                  icon: <resource.icon className="h-4 w-4" />,
                  canDelete: resource.canDelete,
                },
              }))}
              options={{
                syncWithLocation: true,
                warnWhenUnsavedChanges: true,
                projectId: "fFxMzl-ygw30s-D1GNyg",
              }}
            >
              <Routes>
                <Route
                  element={
                    <Layout>
                      <Outlet />
                    </Layout>
                  }
                >
                  <Route
                    index
                    element={<NavigateToResource resource="dashboard" />}
                  />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/staff">
                    <Route index element={<StaffList />} />
                    <Route path="create" element={<StaffCreate />} />
                    <Route path="edit/:id" element={<StaffEdit />} />
                    <Route path="show/:id" element={<StaffShow />} />
                  </Route>
                  <Route path="/categories">
                    <Route index element={<CategoryList />} />
                    <Route path="create" element={<CategoryCreate />} />
                    <Route path="edit/:id" element={<CategoryEdit />} />
                    <Route path="show/:id" element={<CategoryShow />} />
                  </Route>
                  <Route path="/payments">
                    <Route index element={<PaymentList />} />
                    <Route path="create" element={<PaymentCreate />} />
                    <Route path="edit/:id" element={<PaymentEdit />} />
                    <Route path="show/:id" element={<PaymentShow />} />
                  </Route>
                  <Route path="/approvals" element={<ApprovalQueueList />} />
                  <Route
                    path="/disbursements"
                    element={<DisbursementList />}
                  />
                  <Route path="*" element={<ErrorComponent />} />
                </Route>
              </Routes>

              <Toaster />
              <RefineKbar />
              <UnsavedChangesNotifier />
              <DocumentTitleHandler />
            </Refine>
            <DevtoolsPanel />
          </DevtoolsProvider>
        </ThemeProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
