// Helper to format date as DD-MM-YYYY and time as h:mm AM/PM

function formatDateTime(dateStr?: string, timeStr?: string) {
  if (!dateStr && !timeStr) return "";
  let formattedDate = "";
  let formattedTime = "";
  let validDate = false;
  let validTime = false;
  if (dateStr) {
    const [yyyy, mm, dd] = dateStr.split("-");
    if (
      yyyy && mm && dd &&
      yyyy.length === 4 &&
      mm.length === 2 &&
      dd.length === 2 &&
      /^[0-9]+$/.test(yyyy) && /^[0-9]+$/.test(mm) && /^[0-9]+$/.test(dd) &&
      Number(mm) >= 1 && Number(mm) <= 12 &&
      Number(dd) >= 1 && Number(dd) <= 31
    ) {
      formattedDate = `${dd}-${mm}-${yyyy}`;
      validDate = true;
    }
  }
  if (timeStr) {
    const [h, m] = timeStr.split(":");
    if (
      h !== undefined && m !== undefined &&
      /^[0-9]+$/.test(h) && /^[0-9]+$/.test(m) &&
      Number(h) >= 0 && Number(h) <= 23 &&
      Number(m) >= 0 && Number(m) <= 59
    ) {
      let hour = parseInt(h, 10);
      const minute = m;
      const ampm = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      if (hour === 0) hour = 12;
      formattedTime = `${hour}:${minute} ${ampm}`;
      validTime = true;
    }
  }
  if (validDate && validTime) return `${formattedDate} at ${formattedTime}`;
  if (validDate) return formattedDate;
  if (validTime) return formattedTime;
  // If one part is valid, return the valid part and the original for the invalid
  if (dateStr && !validDate && validTime) return `${dateStr} at ${formattedTime}`;
  if (timeStr && !validTime && validDate) return `${formattedDate} at ${timeStr}`;
  // If both are invalid, return the original input
  if (dateStr && timeStr) return `${dateStr} at ${timeStr}`;
  if (dateStr) return dateStr;
  if (timeStr) return timeStr;
  return "";
}

// Format date as DD-MM-YYYY

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  const [yyyy, mm, dd] = dateStr.split("-");
  if (
    yyyy && mm && dd &&
    yyyy.length === 4 &&
    mm.length === 2 &&
    dd.length === 2 &&
    /^[0-9]+$/.test(yyyy) && /^[0-9]+$/.test(mm) && /^[0-9]+$/.test(dd) &&
    Number(mm) >= 1 && Number(mm) <= 12 &&
    Number(dd) >= 1 && Number(dd) <= 31
  ) {
    return `${dd}-${mm}-${yyyy}`;
  }
  return dateStr;
}

// Format time as h:mm AM/PM

function formatTime(timeStr?: string) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  if (
    h !== undefined && m !== undefined &&
    /^[0-9]+$/.test(h) && /^[0-9]+$/.test(m) &&
    Number(h) >= 0 && Number(h) <= 23 &&
    Number(m) >= 0 && Number(m) <= 59
  ) {
    let hour = parseInt(h, 10);
    const minute = m;
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${ampm}`;
  }
  return timeStr;
}

export { formatDateTime, formatDate, formatTime };
