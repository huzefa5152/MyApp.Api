using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.RegularExpressions;
using System.Globalization;
using HtmlAgilityPack;
using MyApp.Api.DTOs;
namespace MyApp.Api.Helpers;
public static class EmailReplyRules
{
    public static List<string> Addresses(string value)
    {
        if (value.Contains('\r') || value.Contains('\n')) throw new InvalidOperationException("Invalid recipient header.");
        var addresses = new MailAddressCollection();
        if (!string.IsNullOrWhiteSpace(value)) addresses.Add(value);
        if (addresses.Count > 50) throw new InvalidOperationException("Too many recipients.");
        return addresses.Select(a => a.Address.ToLowerInvariant()).Distinct().ToList();
    }
    public static EmailContent CurrentContent(EmailContent content)
    {
        var doc = new HtmlDocument(); doc.LoadHtml(content.Html ?? "");
        foreach (var node in doc.DocumentNode.SelectNodes("//blockquote|//*[contains(@class,'gmail_quote')]|//script|//style") ?? Enumerable.Empty<HtmlNode>()) node.Remove();
        var text = !string.IsNullOrWhiteSpace(content.Text) ? content.Text : HtmlEntity.DeEntitize(doc.DocumentNode.InnerText);
        var current = Regex.Split(text, @"(?im)^\s*(?:On .+wrote:|From:|-----Original Message-----|Begin forwarded message:|>).*", RegexOptions.None, TimeSpan.FromSeconds(1))[0].Trim();
        return new(current,doc.DocumentNode.InnerHtml,content.Attachments);
    }
    public static string CurrentText(EmailContent content) => CurrentContent(content).Text;
    public static (List<string> To, List<string> Cc) Recipients(GmailFetchedMessage source, string self, bool all)
    {
        var headers = source.ReplyHeaders ?? throw new InvalidOperationException("Reconnect and refresh this message before replying.");
        if (all && headers.InvalidRecipients) throw new InvalidOperationException("Some recipients are invalid; review this reply in Gmail.");
        var own = Addresses(self).Single();
        var to = Addresses(string.IsNullOrWhiteSpace(headers.ReplyTo) ? source.Sender : headers.ReplyTo);
        if (to.Count == 1 && to[0].Equals(own,StringComparison.OrdinalIgnoreCase)) to = headers.To.ToList();
        if (all) to.AddRange(headers.To);
        to = to.Where(a => !a.Equals(own, StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var cc = (all ? headers.Cc : []).Where(a => !a.Equals(own, StringComparison.OrdinalIgnoreCase) && !to.Contains(a, StringComparer.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (to.Count == 0 || to.Count + cc.Count > 50) throw new InvalidOperationException("This message has no valid reply recipient.");
        return (to, cc);
    }
    public static EmailReplyPreview Build(Guid id, GmailFetchedMessage source, string self, EmailReplyDraftDto draft)
    {
        if (draft.Introduction?.Length > 4000 || draft.Notes?.Length > 4000) throw new InvalidOperationException("Keep reply text within the supported limit.");
        var recipients = Recipients(source, self, draft.ReplyAll);
        var h = source.ReplyHeaders!;
        if (!Regex.IsMatch(h.MessageId, @"^<[^<>\s]+@[^<>\s]+>$", RegexOptions.None, TimeSpan.FromSeconds(1)))
            throw new InvalidOperationException("This message is missing a valid Message-ID; reply from Gmail instead.");
        if (draft.Items == null || draft.Items.Count > 200 || draft.Items.Any(i => i == null || string.IsNullOrWhiteSpace(i.Description)
            || i.Description.Length > 2000 || i.Quantity <= 0 || i.Quantity > 999999999 || i.UnitPrice == null || i.UnitPrice < 0 || i.UnitPrice > 999999999))
            throw new InvalidOperationException("Review every item and enter a non-negative unit price.");
        var text = new StringBuilder((draft.Introduction ?? "").Trim());
        var html = new StringBuilder("<p>" + WebUtility.HtmlEncode(draft.Introduction ?? "").Replace("\n", "<br>") + "</p>");
        if (draft.Items.Count > 0) {
            html.Append("<table border=\"1\" cellpadding=\"8\" cellspacing=\"0\"><tr><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit price (PKR)</th></tr>");
            foreach (var i in draft.Items) {
                var price = i.UnitPrice!.Value.ToString("0.00##########", CultureInfo.InvariantCulture);
                text.Append($"\n{i.Description} | {i.Quantity.ToString(CultureInfo.InvariantCulture)} {i.Unit} | PKR {price}");
                html.Append($"<tr><td>{WebUtility.HtmlEncode(i.Description)}</td><td>{i.Quantity.ToString(CultureInfo.InvariantCulture)}</td><td>{WebUtility.HtmlEncode(i.Unit)}</td><td>{price}</td></tr>");
            }
            html.Append("</table>");
        }
        if (!string.IsNullOrWhiteSpace(draft.Notes)) { text.Append("\n\n"+draft.Notes); html.Append("<p>"+WebUtility.HtmlEncode(draft.Notes).Replace("\n","<br>")+"</p>"); }
        if (draft.IncludeCurrentMessage) {
            var current = CurrentText(source.Content);
            text.Append("\n\nCurrent enquiry:\n" + current);
            html.Append("<hr><p>Current enquiry</p><blockquote>"+WebUtility.HtmlEncode(current).Replace("\n","<br>")+"</blockquote>");
        }
        var refs = Regex.Matches(h.References, @"<[^<>\s]+@[^<>\s]+>", RegexOptions.None, TimeSpan.FromSeconds(1)).Select(m => m.Value).Append(h.MessageId).Distinct().TakeLast(30);
        return new(id,source.Subject,recipients.To,recipients.Cc,text.ToString(),html.ToString(),source.ThreadId,h.MessageId,string.Join(" ",refs));
    }
    public static string MessageId(Guid id) => $"<erp-reply-{id:N}@email-workspace.invalid>";
    public static byte[] Mime(EmailReplyPreview p, string from)
    {
        foreach (var value in p.To.Concat(p.Cc).Append(from).Append(p.InReplyTo).Append(p.References).Append(p.Subject))
            if (value.Contains('\r') || value.Contains('\n')) throw new InvalidOperationException("Invalid mail header.");
        var boundary = "erp_"+p.Id.ToString("N");
        string Enc(string s) => Convert.ToBase64String(Encoding.UTF8.GetBytes(s), Base64FormattingOptions.InsertLineBreaks);
        var words = new List<string>(); var chunk = new StringBuilder(); var size = 0;
        foreach (var rune in p.Subject.EnumerateRunes()) {
            if (size + rune.Utf8SequenceLength > 42) { words.Add("=?UTF-8?B?"+Convert.ToBase64String(Encoding.UTF8.GetBytes(chunk.ToString()))+"?="); chunk.Clear(); size=0; }
            chunk.Append(rune.ToString()); size += rune.Utf8SequenceLength;
        }
        words.Add("=?UTF-8?B?"+Convert.ToBase64String(Encoding.UTF8.GetBytes(chunk.ToString()))+"?=");
        var subject = string.Join("\r\n ",words);
        var mime = $"From: {Addresses(from).Single()}\r\nTo: {string.Join(",\r\n ",p.To)}\r\nCc: {string.Join(",\r\n ",p.Cc)}\r\nSubject: {subject}\r\nMessage-ID: {MessageId(p.Id)}\r\nIn-Reply-To: {p.InReplyTo}\r\nReferences: {(p.References.Length > 80 ? p.References.Replace(" ","\r\n ") : p.References)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{Enc(p.Text)}\r\n--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{Enc(p.Html)}\r\n--{boundary}--\r\n";
        return Encoding.UTF8.GetBytes(mime);
    }
}
