// THQ Calendar: writes Training HQ's backup reminders into the iCloud calendar through macOS's calendar service
// (EventKit), so the Mac's Calendar app never has to open (Fri 10/23, his words: "why does the calendar app keep opening
// by itself?"). The server starts it with `open` (so macOS asks him once, for this app, to allow calendar access) and
// passes two files: the request (JSON) and where to write the answer.
//
//   thqcal <request.json> <answer.txt>   make the calendar hold exactly the requested events (ours only)
//   thqcal --status <answer.txt>         "STATUS ok|denied|asking" without asking
//   thqcal --request <answer.txt>        ask for access now (the prompt), then "STATUS ok|denied|waiting"
//
// Answers match the AppleScript version: "OK <added> <removed> <kept>", "NO_CALENDAR", plus "NO_ACCESS <why>" and
// "ERROR <text>". Only events whose URL starts with the request's prefix are touched.
import Foundation
import EventKit

struct Wanted: Decodable { let key: String; let title: String; let notes: String; let start: Double; let end: Double }
struct Request: Decodable { let calendar: String; let prefix: String; let from: Double; let to: Double; let events: [Wanted] }

let args = CommandLine.arguments
let answerPath: String? = args.count > 2 ? args[2] : nil

func answer(_ text: String) -> Never {
  if let path = answerPath { try? (text + "\n").write(toFile: path, atomically: true, encoding: .utf8) } else { print(text) }
  exit(0)
}

let store = EKEventStore()

/// "ok", "denied", or "waiting" (he hasn't answered the prompt in time); asks only when `ask` and nothing was decided.
func access(ask: Bool) -> String {
  let status = EKEventStore.authorizationStatus(for: .event)
  if status == .fullAccess { return "ok" }
  if status != .notDetermined { return "denied" }
  if !ask { return "asking" }
  let done = DispatchSemaphore(value: 0)
  var granted = false
  store.requestFullAccessToEvents { ok, _ in granted = ok; done.signal() }
  if done.wait(timeout: .now() + 110) == .timedOut { return "waiting" }
  return granted ? "ok" : "denied"
}

if args.count > 1 && args[1] == "--status" { answer("STATUS " + access(ask: false)) }
if args.count > 1 && args[1] == "--request" { answer("STATUS " + access(ask: true)) }

guard args.count > 2, let data = FileManager.default.contents(atPath: args[1]),
      let req = try? JSONDecoder().decode(Request.self, from: data) else { answer("ERROR bad request") }

let granted = access(ask: true)
if granted != "ok" { answer("NO_ACCESS " + granted) }

// His iCloud calendar of that name (the one iCloud sends to his iPhone), else any of that name.
let named = store.calendars(for: .event).filter { $0.title == req.calendar }
guard let calendar = named.first(where: { $0.source.title == "iCloud" }) ?? named.first else { answer("NO_CALENDAR") }

let wantedKeys = Set(req.events.map { $0.key })
var have = Set<String>()
var removed = 0
let range = store.predicateForEvents(withStart: Date(timeIntervalSince1970: req.from), end: Date(timeIntervalSince1970: req.to), calendars: [calendar])
for event in store.events(matching: range) {
  let url = event.url?.absoluteString ?? ""
  guard url.hasPrefix(req.prefix) else { continue }
  if wantedKeys.contains(url) && !have.contains(url) {
    have.insert(url)
  } else {
    do { try store.remove(event, span: .thisEvent, commit: false); removed += 1 } catch { answer("ERROR remove: \(error.localizedDescription)") }
  }
}
let kept = have.count
var added = 0
for want in req.events where !have.contains(want.key) {
  let event = EKEvent(eventStore: store)
  event.calendar = calendar
  event.title = want.title
  event.notes = want.notes
  event.startDate = Date(timeIntervalSince1970: want.start)
  event.endDate = Date(timeIntervalSince1970: want.end)
  event.url = URL(string: want.key)
  event.addAlarm(EKAlarm(relativeOffset: 0))
  do { try store.save(event, span: .thisEvent, commit: false); added += 1 } catch { answer("ERROR save: \(error.localizedDescription)") }
  have.insert(want.key)
}
do { try store.commit() } catch { answer("ERROR commit: \(error.localizedDescription)") }
answer("OK \(added) \(removed) \(kept)")
