# Frontend Fetch Examples for RND CRM API

Use Clerk sessions in Next.js and include `Authorization: Bearer <token>` from Clerk JWT.

## Common helper

```js
import { currentUser, getAuth } from "@clerk/nextjs";

const fetchApi = async (url, options = {}) => {
  const token = await getAuth().getToken({ template: "default" });
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed ${res.status}`);
  }

  return res.json();
};
```

## Get current user

```js
const getCurrentUser = async () => {
  return fetchApi("/api/users/me");
};
```

## Leads CRUD

- `GET /api/leads`
- `POST /api/leads` (body: `name, phone, source, status, assigned_to, notes`)
- `GET /api/leads/:id`
- `PUT /api/leads/:id`
- `DELETE /api/leads/:id`

```js
const listLeads = () => fetchApi("/api/leads?my=true");

const createLead = (payload) => fetchApi("/api/leads", { method: "POST", body: JSON.stringify(payload) });

const updateLead = (id, payload) => fetchApi(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify(payload) });

const deleteLead = (id) => fetchApi(`/api/leads/${id}`, { method: "DELETE" });
```

## Tasks CRUD

```js
const listTasks = () => fetchApi("/api/tasks?my=true");
const createTask = (payload) => fetchApi("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
const updateTask = (id, payload) => fetchApi(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(payload) });
const deleteTask = (id) => fetchApi(`/api/tasks/${id}`, { method: "DELETE" });
```

## Dashboard

```js
const getDashboard = () => fetchApi("/api/dashboard");
```

## IndiaMart integration

```js
const submitIndiaMartLead = (payload) => fetchApi("/api/integrations/indiamart", { method: "POST", body: JSON.stringify(payload) });
```
