import EventKit
import Dispatch
import Foundation

enum ExitCode: Int32 {
  case ok = 0
  case runtimeError = 1
  case usage = 2
  case permissionDenied = 3
}

struct Options {
  var json: Bool = false
  var listCalendars: Bool = false
  var authStatus: Bool = false
  var noPrompt: Bool = false

  var calendarFilters: [String] = []
  var startRaw: String? = nil
  var endRaw: String? = nil
  var dayRaw: String? = nil
  var windowRaw: String? = nil

  var maxEvents: Int = 200
  var maxNotesChars: Int = 2000
  var maxAttendees: Int = 50

  var includeDeclined: Bool = false
  var includeCanceled: Bool = false
  var excludeAllDay: Bool = false
}

enum ArgParseError: Error {
  case help
  case message(String)
}

func writeJSON(_ obj: Any) {
  do {
    let data = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
    if let s = String(data: data, encoding: .utf8) {
      print(s)
    } else {
      print("{\"ok\":false,\"error\":{\"code\":\"ENCODING\",\"message\":\"utf8 encode failed\"}}")
    }
  } catch {
    print(
      "{\"ok\":false,\"error\":{\"code\":\"SERIALIZE\",\"message\":\"JSON serialization failed\"}}"
    )
  }
}

func writeError(code: String, message: String, details: [String: Any]? = nil) {
  var err: [String: Any] = ["code": code, "message": message]
  if let details = details {
    err["details"] = details
  }
  writeJSON(["ok": false, "error": err])
}

func usage() -> String {
  return """
  Usage:
    openclaw-calendar --json [--list-calendars]
    openclaw-calendar --json --auth-status

  Event query flags:
    --day <today|tomorrow|yesterday|YYYY-MM-DD>
    --start <RFC3339>
    --end <RFC3339>
    --window <dur> (e.g. 36h, 15m, 2d; default: 36h when no end is provided)
    --calendar <title-or-id> (repeatable)

  Output tuning:
    --max-events <n> (default: 200)
    --max-notes-chars <n> (default: 2000)
    --max-attendees <n> (default: 50)
    --include-declined
    --include-canceled
    --exclude-all-day

  Permission/debug:
    --auth-status   Print current EventKit authorization status and exit.
    --no-prompt     Do not request Calendar permission (fail fast if not already authorized).
  """
}

func parseInt(_ s: String) -> Int? {
  let trimmed = s.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
  return Int(trimmed)
}

func parseDurationSeconds(_ raw: String) -> TimeInterval? {
  let s = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).lowercased()
  if s.isEmpty {
    return nil
  }
  let units: [(String, Double)] = [("ms", 0.001), ("s", 1), ("m", 60), ("h", 3600), ("d", 86400)]
  for (suffix, factor) in units {
    if s.hasSuffix(suffix) {
      let numRaw = String(s.dropLast(suffix.count))
      guard
        let value = Double(numRaw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines))
      else {
        return nil
      }
      return TimeInterval(value * factor)
    }
  }
  // No unit: interpret as hours.
  guard let value = Double(s) else {
    return nil
  }
  return TimeInterval(value * 3600)
}

func parseISO8601(_ raw: String) -> Date? {
  let trimmed = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
  if trimmed.isEmpty {
    return nil
  }
  let fmt = ISO8601DateFormatter()
  fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let d = fmt.date(from: trimmed) {
    return d
  }
  fmt.formatOptions = [.withInternetDateTime]
  if let d = fmt.date(from: trimmed) {
    return d
  }
  return nil
}

func parseYYYYMMDD(_ raw: String) -> Date? {
  let trimmed = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
  if trimmed.isEmpty {
    return nil
  }
  let df = DateFormatter()
  df.locale = Locale(identifier: "en_US_POSIX")
  df.timeZone = TimeZone.current
  df.dateFormat = "yyyy-MM-dd"
  return df.date(from: trimmed)
}

func formatISO8601(_ d: Date) -> String {
  let fmt = ISO8601DateFormatter()
  fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  // Use local timezone for readability.
  fmt.timeZone = TimeZone.current
  return fmt.string(from: d)
}

func startOfDay(for d: Date) -> Date {
  return Calendar.current.startOfDay(for: d)
}

func parseDayStart(_ raw: String) -> Date? {
  let s = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).lowercased()
  let now = Date()
  if s == "today" {
    return startOfDay(for: now)
  }
  if s == "tomorrow" {
    if let d = Calendar.current.date(byAdding: .day, value: 1, to: startOfDay(for: now)) {
      return d
    }
    return nil
  }
  if s == "yesterday" {
    if let d = Calendar.current.date(byAdding: .day, value: -1, to: startOfDay(for: now)) {
      return d
    }
    return nil
  }
  if let d = parseYYYYMMDD(raw) {
    return startOfDay(for: d)
  }
  return nil
}

func ekSourceTypeString(_ t: EKSourceType) -> String {
  switch t {
  case .local: return "local"
  case .exchange: return "exchange"
  case .calDAV: return "caldav"
  case .mobileMe: return "mobileme"
  case .subscribed: return "subscribed"
  case .birthdays: return "birthdays"
  @unknown default: return "unknown"
  }
}

func ekCalendarTypeString(_ t: EKCalendarType) -> String {
  switch t {
  case .local: return "local"
  case .calDAV: return "caldav"
  case .exchange: return "exchange"
  case .subscription: return "subscription"
  case .birthday: return "birthday"
  @unknown default: return "unknown"
  }
}

func ekEventStatusString(_ t: EKEventStatus) -> String {
  switch t {
  case .none: return "none"
  case .confirmed: return "confirmed"
  case .tentative: return "tentative"
  case .canceled: return "canceled"
  @unknown default: return "unknown"
  }
}

func ekAvailabilityString(_ t: EKEventAvailability) -> String {
  switch t {
  case .notSupported: return "not_supported"
  case .busy: return "busy"
  case .free: return "free"
  case .tentative: return "tentative"
  case .unavailable: return "unavailable"
  @unknown default: return "unknown"
  }
}

func ekAuthorizationStatusString(_ s: EKAuthorizationStatus) -> String {
  switch s {
  case .notDetermined: return "not_determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .authorized: return "authorized"
  @unknown default: return "unknown"
  }
}

func isAuthorizedForRead(_ s: EKAuthorizationStatus) -> Bool {
  switch s {
  case .authorized:
    return true
  default:
    return false
  }
}

func ekParticipantRoleString(_ t: EKParticipantRole) -> String {
  switch t {
  case .unknown: return "unknown"
  case .required: return "required"
  case .optional: return "optional"
  case .chair: return "chair"
  case .nonParticipant: return "non_participant"
  @unknown default: return "unknown"
  }
}

func ekParticipantStatusString(_ t: EKParticipantStatus) -> String {
  switch t {
  case .unknown: return "unknown"
  case .pending: return "pending"
  case .accepted: return "accepted"
  case .declined: return "declined"
  case .tentative: return "tentative"
  case .delegated: return "delegated"
  case .completed: return "completed"
  case .inProcess: return "in_process"
  @unknown default: return "unknown"
  }
}

func ekParticipantTypeString(_ t: EKParticipantType) -> String {
  switch t {
  case .unknown: return "unknown"
  case .person: return "person"
  case .room: return "room"
  case .resource: return "resource"
  case .group: return "group"
  @unknown default: return "unknown"
  }
}

func emailFromParticipantURL(_ url: URL?) -> String? {
  guard let url = url else {
    return nil
  }
  let scheme = url.scheme?.lowercased() ?? ""
  if scheme == "mailto" {
    let path = url.path
    if !path.isEmpty {
      return path
    }
    // Fallback: parse `mailto:` prefix from absolute string.
    let abs = url.absoluteString
    if abs.lowercased().hasPrefix("mailto:") {
      let addr = String(abs.dropFirst("mailto:".count))
      return addr.isEmpty ? nil : addr
    }
    return nil
  }
  return nil
}

func participantPayload(_ p: EKParticipant) -> [String: Any] {
  var obj: [String: Any] = [
    "name": p.name ?? "",
    "isCurrentUser": p.isCurrentUser,
    "role": ekParticipantRoleString(p.participantRole),
    "status": ekParticipantStatusString(p.participantStatus),
    "type": ekParticipantTypeString(p.participantType),
  ]
  if let email = emailFromParticipantURL(p.url) {
    obj["email"] = email
  }
  let urlStr = p.url.absoluteString
  if !urlStr.isEmpty {
    obj["url"] = urlStr
  }
  return obj
}

func isDeclinedForCurrentUser(_ event: EKEvent) -> Bool {
  guard let attendees = event.attendees else {
    return false
  }
  for a in attendees {
    if a.isCurrentUser && a.participantStatus == .declined {
      return true
    }
  }
  return false
}

func truncate(_ raw: String, maxChars: Int) -> (String, Bool) {
  if maxChars < 0 {
    return (raw, false)
  }
  if raw.count <= maxChars {
    return (raw, false)
  }
  let idx = raw.index(raw.startIndex, offsetBy: maxChars)
  return (String(raw[..<idx]) + "... (truncated)", true)
}

func parseArgs() -> Result<Options, ArgParseError> {
  var opts = Options()
  let args = Array(CommandLine.arguments.dropFirst())
  var i = 0
  func nextValue(_ flag: String) -> Result<String, ArgParseError> {
    if i + 1 >= args.count {
      return .failure(.message("missing value for \(flag)"))
    }
    return .success(args[i + 1])
  }
  while i < args.count {
    let a = args[i]
    if a == "-h" || a == "--help" {
      return .failure(.help)
    }
    switch a {
    case "--json":
      opts.json = true
      i += 1
    case "--list-calendars":
      opts.listCalendars = true
      i += 1
    case "--auth-status":
      opts.authStatus = true
      i += 1
    case "--no-prompt":
      opts.noPrompt = true
      i += 1
    case "--calendar":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        opts.calendarFilters.append(v)
        i += 2
      }
    case "--start":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        opts.startRaw = v
        i += 2
      }
    case "--end":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        opts.endRaw = v
        i += 2
      }
    case "--day":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        opts.dayRaw = v
        i += 2
      }
    case "--window":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        opts.windowRaw = v
        i += 2
      }
    case "--max-events":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        guard let n = parseInt(v), n > 0 else {
          return .failure(.message("invalid --max-events (expected positive integer)"))
        }
        opts.maxEvents = n
        i += 2
      }
    case "--max-notes-chars":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        guard let n = parseInt(v), n >= 0 else {
          return .failure(.message("invalid --max-notes-chars (expected non-negative integer)"))
        }
        opts.maxNotesChars = n
        i += 2
      }
    case "--max-attendees":
      switch nextValue(a) {
      case .failure(let err): return .failure(err)
      case .success(let v):
        guard let n = parseInt(v), n >= 0 else {
          return .failure(.message("invalid --max-attendees (expected non-negative integer)"))
        }
        opts.maxAttendees = n
        i += 2
      }
    
    case "--include-declined":
      opts.includeDeclined = true
      i += 1
    case "--include-canceled":
      opts.includeCanceled = true
      i += 1
    case "--exclude-all-day":
      opts.excludeAllDay = true
      i += 1
    default:
      if a.hasPrefix("--") {
        return .failure(.message("unknown flag: \(a)"))
      }
      return .failure(.message("unexpected arg: \(a)"))
    }
  }
  return .success(opts)
}

let parsed = parseArgs()
switch parsed {
case .failure(let err):
  switch err {
  case .help:
    fputs(usage() + "\n", stderr)
    exit(ExitCode.usage.rawValue)
  case .message(let msg):
    writeError(code: "USAGE", message: msg, details: ["usage": usage()])
    exit(ExitCode.usage.rawValue)
  }
case .success(let opts): do {
  if !opts.json {
    writeError(code: "USAGE", message: "--json is required", details: ["usage": usage()])
    exit(ExitCode.usage.rawValue)
  }

  let tz = TimeZone.current.identifier

  if opts.authStatus {
    let status = EKEventStore.authorizationStatus(for: .event)
    writeJSON([
      "ok": true,
      "timeZone": tz,
      "authorization": [
        "entity": "event",
        "status": ekAuthorizationStatusString(status),
      ],
    ])
    exit(ExitCode.ok.rawValue)
  }

  let store = EKEventStore()
  let status = EKEventStore.authorizationStatus(for: .event)
  if !isAuthorizedForRead(status) {
    if status == .notDetermined && !opts.noPrompt {
      let sema = DispatchSemaphore(value: 0)
      var granted = false
      var accessError: Error? = nil
      store.requestAccess(to: .event) { ok, err in
        granted = ok
        accessError = err
        sema.signal()
      }
      let waitRes = sema.wait(timeout: DispatchTime.now() + .seconds(30))
      if waitRes == .timedOut {
        writeError(
          code: "TIMEOUT",
          message:
            "timed out waiting for Calendar permission prompt. If you're running in a background/hardened context (launchd, CI, some desktop apps), the prompt may be blocked. Run openclaw-calendar once from Terminal.app to grant permission, or enable it in System Settings -> Privacy & Security -> Calendars."
        )
        exit(ExitCode.permissionDenied.rawValue)
      }
      if let accessError = accessError {
        writeError(code: "PERMISSION_ERROR", message: accessError.localizedDescription)
        exit(ExitCode.permissionDenied.rawValue)
      }
      if !granted {
        let afterStatus = EKEventStore.authorizationStatus(for: .event)
        writeError(
          code: "PERMISSION_DENIED",
          message:
            "Calendar access denied (status: \(ekAuthorizationStatusString(afterStatus))). If you were expecting a permission prompt, run openclaw-calendar once from Terminal.app to trigger it. You can also enable access in System Settings -> Privacy & Security -> Calendars."
        )
        exit(ExitCode.permissionDenied.rawValue)
      }
    } else {
      let extra =
        status == .notDetermined
        ? " If you were expecting a permission prompt, run openclaw-calendar once from Terminal.app to trigger it."
        : ""
      writeError(
        code: "PERMISSION_DENIED",
        message:
          "Calendar access is not authorized (status: \(ekAuthorizationStatusString(status))). Enable Calendars access for openclaw-calendar in System Settings -> Privacy & Security -> Calendars.\(extra)"
      )
      exit(ExitCode.permissionDenied.rawValue)
    }
  }

  if opts.listCalendars {
    let calendars = store.calendars(for: .event)
      .sorted { ($0.title.lowercased(), $0.calendarIdentifier) < ($1.title.lowercased(), $1.calendarIdentifier) }
      .map { cal -> [String: Any] in
        return [
          "id": cal.calendarIdentifier,
          "title": cal.title,
          "type": ekCalendarTypeString(cal.type),
          "allowsContentModifications": cal.allowsContentModifications,
          "source": [
            "title": cal.source.title,
            "type": ekSourceTypeString(cal.source.sourceType),
          ],
        ]
      }
    writeJSON(["ok": true, "timeZone": tz, "calendars": calendars])
    exit(ExitCode.ok.rawValue)
  }

  let now = Date()
  let defaultWindowSeconds: TimeInterval = 36 * 3600

  var start: Date? = nil
  if let raw = opts.startRaw {
    start = parseISO8601(raw) ?? parseYYYYMMDD(raw)
  } else if let raw = opts.dayRaw {
    start = parseDayStart(raw)
  }
  if start == nil {
    start = now
  }

  let window = opts.windowRaw.flatMap(parseDurationSeconds)
  if opts.windowRaw != nil && window == nil {
    writeError(code: "INVALID_REQUEST", message: "invalid --window (expected e.g. 36h, 15m, 2d)")
    exit(ExitCode.usage.rawValue)
  }

  var end: Date? = nil
  if let raw = opts.endRaw {
    end = parseISO8601(raw) ?? parseYYYYMMDD(raw)
  } else if opts.dayRaw != nil && window == nil {
    end = Calendar.current.date(byAdding: .day, value: 1, to: start!)
  } else {
    end = start!.addingTimeInterval(window ?? defaultWindowSeconds)
  }

  guard let startDate = start, let endDate = end else {
    writeError(code: "INVALID_REQUEST", message: "unable to resolve time range")
    exit(ExitCode.usage.rawValue)
  }
  if endDate <= startDate {
    writeError(code: "INVALID_REQUEST", message: "end must be after start")
    exit(ExitCode.usage.rawValue)
  }

  let allCalendars = store.calendars(for: .event)
  var unmatchedCalendars: [String] = []
  var selectedCalendars: [EKCalendar]? = nil
  if !opts.calendarFilters.isEmpty {
    var matches: [EKCalendar] = []
    for filter in opts.calendarFilters {
      let f = filter.trimmingCharacters(in: .whitespacesAndNewlines)
      if f.isEmpty {
        continue
      }
      let found = allCalendars.filter { cal in
        if cal.calendarIdentifier == f {
          return true
        }
        return cal.title.caseInsensitiveCompare(f) == .orderedSame
      }
      if found.isEmpty {
        unmatchedCalendars.append(f)
      } else {
        matches.append(contentsOf: found)
      }
    }
    // De-dupe by identifier
    var seen = Set<String>()
    selectedCalendars = []
    for cal in matches {
      if seen.contains(cal.calendarIdentifier) {
        continue
      }
      seen.insert(cal.calendarIdentifier)
      selectedCalendars?.append(cal)
    }
  }

  let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: selectedCalendars)
  let rawEvents = store.events(matching: predicate)
    .sorted {
      if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
      if $0.endDate != $1.endDate { return $0.endDate < $1.endDate }
      return ($0.title ?? "") < ($1.title ?? "")
    }

  var eventsOut: [[String: Any]] = []
  eventsOut.reserveCapacity(min(opts.maxEvents, rawEvents.count))

  for ev in rawEvents {
    if !opts.includeCanceled && ev.status == .canceled {
      continue
    }
    if opts.excludeAllDay && ev.isAllDay {
      continue
    }
    if !opts.includeDeclined && isDeclinedForCurrentUser(ev) {
      continue
    }

    let notesRaw = ev.notes ?? ""
    let (notes, notesTruncated) = truncate(notesRaw, maxChars: opts.maxNotesChars)

    let attendeesAll = ev.attendees ?? []
    let attendeesLimited = Array(attendeesAll.prefix(opts.maxAttendees))
    let attendeesTruncated = attendeesAll.count > attendeesLimited.count

    var obj: [String: Any] = [
      "id": ev.eventIdentifier ?? "",
      "title": ev.title ?? "",
      "start": formatISO8601(ev.startDate),
      "end": formatISO8601(ev.endDate),
      "isAllDay": ev.isAllDay,
      "status": ekEventStatusString(ev.status),
      "availability": ekAvailabilityString(ev.availability),
      "calendar": [
        "id": ev.calendar.calendarIdentifier,
        "title": ev.calendar.title,
        "type": ekCalendarTypeString(ev.calendar.type),
        "source": [
          "title": ev.calendar.source.title,
          "type": ekSourceTypeString(ev.calendar.source.sourceType),
        ],
      ],
      "notes": notes,
      "notesTruncated": notesTruncated,
      "attendeeCount": attendeesAll.count,
      "attendeesTruncated": attendeesTruncated,
      "attendees": attendeesLimited.map(participantPayload),
    ]
    if let location = ev.location, !location.isEmpty {
      obj["location"] = location
    }
    if let url = ev.url?.absoluteString, !url.isEmpty {
      obj["url"] = url
    }
    if let organizer = ev.organizer {
      obj["organizer"] = participantPayload(organizer)
    }
    if let lastModified = ev.lastModifiedDate {
      obj["lastModified"] = formatISO8601(lastModified)
    }
    if let created = ev.creationDate {
      obj["created"] = formatISO8601(created)
    }
    obj["hasRecurrenceRules"] = (ev.recurrenceRules?.isEmpty == false)

    eventsOut.append(obj)
    if eventsOut.count >= opts.maxEvents {
      break
    }
  }

  var res: [String: Any] = [
    "ok": true,
    "timeZone": tz,
    "range": [
      "start": formatISO8601(startDate),
      "end": formatISO8601(endDate),
    ],
    "filters": [
      "calendarFilters": opts.calendarFilters,
      "includeDeclined": opts.includeDeclined,
      "includeCanceled": opts.includeCanceled,
      "excludeAllDay": opts.excludeAllDay,
      "maxEvents": opts.maxEvents,
      "maxNotesChars": opts.maxNotesChars,
      "maxAttendees": opts.maxAttendees,
    ],
    "events": eventsOut,
  ]
  if !unmatchedCalendars.isEmpty {
    res["unmatchedCalendars"] = unmatchedCalendars
  }
  writeJSON(res)
  exit(ExitCode.ok.rawValue)
} }
