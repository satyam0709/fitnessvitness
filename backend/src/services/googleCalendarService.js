let googleApi = null;

function getGoogleApi() {
  if (googleApi) return googleApi;
  try {
    // Optional dependency: keep calendar API functional even if googleapis is not installed.
    // eslint-disable-next-line global-require
    googleApi = require("googleapis").google;
    return googleApi;
  } catch {
    return null;
  }
}

async function getClient(token) {
  const google = getGoogleApi();
  if (!google) {
    throw new Error("Google Calendar integration is not installed");
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.calendar({ version: "v3", auth });
}

async function fetchGoogleEvents(token, from, to) {
  const calendar = await getClient(token);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items.map((e) => ({
    id: `google-${e.id}`,
    source: "google",
    type: "event",
    title: e.summary || "No Title",
    description: e.description || null,
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    allDay: !!e.start.date,
  }));
}

async function createGoogleEvent(token, event) {
  const calendar = await getClient(token);

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start },
      end: { dateTime: event.end || event.start },
    },
  });

  return res.data.id;
}

async function updateGoogleEvent(token, id, event) {
  const calendar = await getClient(token);

  await calendar.events.update({
    calendarId: "primary",
    eventId: id,
    requestBody: {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start },
      end: { dateTime: event.end || event.start },
    },
  });
}

async function deleteGoogleEvent(token, id) {
  const calendar = await getClient(token);

  await calendar.events.delete({
    calendarId: "primary",
    eventId: id,
  });
}

module.exports = {
  fetchGoogleEvents,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
};