using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    public enum DemandKind { Order, Challan, Bill }

    public sealed record DemandRef(DemandKind Kind, int LineId);

    /// <summary>
    /// One customer demand followed through its documents: a sales order line,
    /// the challan lines that deliver it and the sale bill lines that bill it.
    /// Its root is the order line when there is one, else the challan line, else
    /// the bill line. Whatever stage a purchase links to, it counts against the
    /// whole trail, so the same goods are never bought twice.
    /// </summary>
    public sealed class DemandTrail
    {
        public string Key { get; init; } = "";
        public CustomerDemand.Line? Order { get; set; }
        public List<CustomerDemand.Line> Challans { get; } = new();
        public List<CustomerDemand.Line> Bills { get; } = new();
        public decimal Bought { get; set; }

        public decimal Ordered => Order?.Qty ?? 0;
        public decimal Delivered => Challans.Sum(c => c.Qty);
        public decimal Billed => Bills.Sum(b => b.Qty);
        public decimal ToBuy => Math.Max(Ordered, Math.Max(Delivered, Billed));
        public decimal Left => ToBuy - Bought;

        public IEnumerable<CustomerDemand.Line> Members =>
            (Order == null ? Enumerable.Empty<CustomerDemand.Line>() : new[] { Order }).Concat(Challans).Concat(Bills);

        /// <summary>The newest line, which names the goods best.</summary>
        public CustomerDemand.Line Latest =>
            Bills.OrderByDescending(b => b.Id).FirstOrDefault()
            ?? Challans.OrderByDescending(c => c.Id).FirstOrDefault()
            ?? Order!;

        public CustomerDemand.Line? Planned => Challans.FirstOrDefault(c => c.SupplierId != null);
        public decimal? Cost => Challans.FirstOrDefault(c => c.Cost != null)?.Cost;

        /// <summary>"Order #12 → DC #101 → Bill #55" for messages.</summary>
        public string Path =>
            string.Join(" → ", Members.Select(m => m.Doc).DistinctBy(d => (d.Kind, d.Id))
                .Select(d => $"{CustomerDemand.MessageLabel(d.Kind)} #{d.Number}"));
    }

    /// <summary>
    /// Reads and checks customer demand for purchases: what each trail wants,
    /// what is bought, what is left. The one place these rules live — the
    /// purchase picker, purchase saves and the order / challan / bill guards
    /// all go through it.
    /// </summary>
    public sealed class CustomerDemand
    {
        public sealed record Doc(DemandKind Kind, int Id, int Number, string Client, DateTime? Date, string? Po, int? DivisionId);

        public sealed record Line(
            DemandKind Kind, int Id, Doc Doc, decimal Qty, string Description, string Unit,
            int? ItemTypeId, string? ItemTypeName, int? NonInventoryItemId,
            int? SalesOrderItemId, int? DeliveryItemId, int? SupplierId, string? SupplierName, decimal? Cost);

        private readonly AppDbContext _db;
        private readonly Dictionary<int, Line> _orders = new(), _challans = new(), _bills = new();
        private readonly Dictionary<string, DemandTrail> _trails = new();
        private readonly Dictionary<(DemandKind, int), DemandTrail> _trailOf = new();
        private int _companyId;

        public CustomerDemand(AppDbContext db) => _db = db;

        public static string Tag(DemandKind k) => k switch { DemandKind.Order => "order", DemandKind.Challan => "challan", _ => "bill" };
        public static string MessageLabel(DemandKind k) => k switch { DemandKind.Order => "Order", DemandKind.Challan => "DC", _ => "Bill" };

        public static DemandKind? ParseKind(string? kind) => kind?.Trim().ToLowerInvariant() switch
        {
            "order" => DemandKind.Order,
            "challan" => DemandKind.Challan,
            "bill" => DemandKind.Bill,
            _ => null,
        };

        public DemandTrail? TrailOf(DemandRef r) => _trailOf.GetValueOrDefault((r.Kind, r.LineId));

        public IEnumerable<DemandTrail> Trails => _trails.Values;

        /// <summary>
        /// Loads every live order, challan and bill line of the company and
        /// builds the trails. Cancelled and demo documents, credit and debit
        /// notes are not demand. A cancelled order keeps its delivered lines
        /// but no longer asks for the undelivered rest.
        /// </summary>
        // ponytail: loads the company's line projections into memory; move the trail grouping into SQL if a company passes ~100k lines.
        public async Task LoadAsync(int companyId)
        {
            _companyId = companyId;
            var orders = await _db.SalesOrderItems.AsNoTracking()
                .Where(i => i.SalesOrder.CompanyId == companyId)
                .Select(i => new
                {
                    i.Id,
                    DocId = i.SalesOrderId,
                    i.SalesOrder.SalesOrderNumber,
                    Client = i.SalesOrder.Client.Name,
                    Date = (DateTime?)i.SalesOrder.OrderDate,
                    Po = i.SalesOrder.CustomerPoNumber,
                    i.SalesOrder.DivisionId,
                    Qty = i.SalesOrder.Status == "Cancelled" ? 0 : i.Quantity,
                    i.Description,
                    i.Unit,
                    i.ItemTypeId,
                    ItemTypeName = i.ItemType != null ? i.ItemType.Name : null,
                    i.NonInventoryItemId,
                }).ToListAsync();
            var challans = await _db.DeliveryItems.AsNoTracking()
                .Where(i => i.DeliveryChallan.CompanyId == companyId && i.DeliveryChallan.Status != "Cancelled" && !i.DeliveryChallan.IsDemo)
                .Select(i => new
                {
                    i.Id,
                    DocId = i.DeliveryChallanId,
                    i.DeliveryChallan.ChallanNumber,
                    Client = i.DeliveryChallan.Client.Name,
                    i.DeliveryChallan.DeliveryDate,
                    Po = i.DeliveryChallan.PoNumber,
                    i.DeliveryChallan.DivisionId,
                    Qty = i.DeliveredQuantity ?? i.Quantity,
                    i.Description,
                    i.Unit,
                    i.ItemTypeId,
                    ItemTypeName = i.ItemType != null ? i.ItemType.Name : null,
                    i.NonInventoryItemId,
                    i.SalesOrderItemId,
                    i.SupplierId,
                    SupplierName = i.Supplier != null ? i.Supplier.Name : null,
                    i.ActualUnitCost,
                }).ToListAsync();
            var bills = await _db.InvoiceItems.AsNoTracking()
                .Where(i => i.Invoice.CompanyId == companyId && !i.Invoice.IsCancelled && !i.Invoice.IsDemo
                            && (i.Invoice.DocumentType ?? 0) != 9 && (i.Invoice.DocumentType ?? 0) != 10)
                .Select(i => new
                {
                    i.Id,
                    DocId = i.InvoiceId,
                    i.Invoice.InvoiceNumber,
                    Client = i.Invoice.Client.Name,
                    Date = (DateTime?)i.Invoice.Date,
                    i.Invoice.DivisionId,
                    i.Quantity,
                    i.Description,
                    i.UOM,
                    i.ItemTypeId,
                    i.ItemTypeName,
                    i.NonInventoryItemId,
                    i.SalesOrderItemId,
                    i.DeliveryItemId,
                }).ToListAsync();

            foreach (var o in orders)
                _orders[o.Id] = new Line(DemandKind.Order, o.Id,
                    new Doc(DemandKind.Order, o.DocId, o.SalesOrderNumber, o.Client, o.Date, o.Po, o.DivisionId),
                    o.Qty, o.Description, o.Unit, o.ItemTypeId, o.ItemTypeName, o.NonInventoryItemId, null, null, null, null, null);
            foreach (var c in challans)
                _challans[c.Id] = new Line(DemandKind.Challan, c.Id,
                    new Doc(DemandKind.Challan, c.DocId, c.ChallanNumber, c.Client, c.DeliveryDate, c.Po, c.DivisionId),
                    c.Qty, c.Description, c.Unit, c.ItemTypeId, c.ItemTypeName, c.NonInventoryItemId,
                    c.SalesOrderItemId, null, c.SupplierId, c.SupplierName, c.ActualUnitCost);
            foreach (var b in bills)
                _bills[b.Id] = new Line(DemandKind.Bill, b.Id,
                    new Doc(DemandKind.Bill, b.DocId, b.InvoiceNumber, b.Client, b.Date, null, b.DivisionId),
                    b.Quantity, b.Description, b.UOM, b.ItemTypeId, string.IsNullOrEmpty(b.ItemTypeName) ? null : b.ItemTypeName,
                    b.NonInventoryItemId, b.SalesOrderItemId, b.DeliveryItemId, null, null, null);

            DemandTrail TrailFor(string key) => _trails.TryGetValue(key, out var t) ? t : _trails[key] = new DemandTrail { Key = key };

            foreach (var o in _orders.Values)
                Attach(TrailFor("o:" + o.Id), o);
            foreach (var c in _challans.Values)
                Attach(TrailFor(c.SalesOrderItemId is int so && _orders.ContainsKey(so) ? "o:" + so : "c:" + c.Id), c);
            foreach (var b in _bills.Values)
            {
                // The challan link wins over the bill's own order link, so a line is never in two trails.
                var trail = b.DeliveryItemId is int di && _trailOf.TryGetValue((DemandKind.Challan, di), out var viaChallan) ? viaChallan
                    : b.SalesOrderItemId is int so && _orders.ContainsKey(so) ? _trailOf[(DemandKind.Order, so)]
                    : TrailFor("b:" + b.Id);
                Attach(trail, b);
            }
        }

        private void Attach(DemandTrail t, Line l)
        {
            if (l.Kind == DemandKind.Order) t.Order = l;
            else if (l.Kind == DemandKind.Challan) t.Challans.Add(l);
            else t.Bills.Add(l);
            _trailOf[(l.Kind, l.Id)] = t;
        }

        /// <summary>
        /// Adds what is bought to every trail, leaving out <paramref name="excludeBillId"/>
        /// (the bill being edited). A challan bought by its own "Create purchase bills"
        /// before purchase rows recorded their sources counts as fully bought.
        /// </summary>
        public async Task LoadBoughtAsync(int? excludeBillId)
        {
            foreach (var t in _trails.Values) t.Bought = 0;
            var sources = await _db.PurchaseItemSources.AsNoTracking()
                .Where(s => s.PurchaseItem.PurchaseBill.CompanyId == _companyId && s.PurchaseItem.PurchaseBillId != excludeBillId)
                .Select(s => new { s.SalesOrderItemId, s.DeliveryItemId, s.InvoiceItemId, s.Quantity })
                .ToListAsync();
            foreach (var s in sources)
            {
                var key = s.SalesOrderItemId is int o ? (DemandKind.Order, o)
                    : s.DeliveryItemId is int d ? (DemandKind.Challan, d)
                    : (DemandKind.Bill, s.InvoiceItemId!.Value);
                if (_trailOf.TryGetValue(key, out var t)) t.Bought += s.Quantity;
            }
            var wholeChallans = await _db.PurchaseBills.AsNoTracking()
                .Where(p => p.CompanyId == _companyId && p.SourceDeliveryChallanId != null && p.Id != excludeBillId
                            && !p.Items.Any(i => i.Sources.Any()))
                .Select(p => p.SourceDeliveryChallanId!.Value).Distinct().ToListAsync();
            foreach (var c in _challans.Values.Where(c => wholeChallans.Contains(c.Doc.Id)))
                _trailOf[(DemandKind.Challan, c.Id)].Bought += c.Qty;
        }

        /// <summary>
        /// Locks the roots of the trails behind <paramref name="refs"/> so two
        /// saves that claim the same trail run one after the other. Call inside
        /// the save's transaction, after <see cref="LoadAsync"/> and before
        /// <see cref="LoadBoughtAsync"/>.
        /// </summary>
        public async Task LockAsync(IEnumerable<DemandRef> refs)
        {
            var roots = refs.Select(TrailOf).Where(t => t != null).Select(t => t!.Key).Distinct().ToList();
            foreach (var (prefix, table) in new[] { ("o:", "SalesOrderItems"), ("c:", "DeliveryItems"), ("b:", "InvoiceItems") })
            {
                var ids = roots.Where(k => k.StartsWith(prefix)).Select(k => int.Parse(k[2..])).ToList();
                if (ids.Count == 0) continue;
                // ids are ints parsed from our own trail keys, never caller text.
#pragma warning disable EF1002
                await _db.Database.ExecuteSqlRawAsync(
                    $"SELECT Id FROM {table} WITH (UPDLOCK, HOLDLOCK) WHERE Id IN ({string.Join(",", ids)})");
#pragma warning restore EF1002
            }
        }

        /// <summary>The documents behind a trail, oldest stage first.</summary>
        public static List<DemandTagDto> Tags(DemandTrail t, ISet<DemandKind>? viewable = null) =>
            t.Members.Select(m => m.Doc).DistinctBy(d => (d.Kind, d.Id))
                .Where(d => viewable == null || viewable.Contains(d.Kind))
                .Select(d => new DemandTagDto { Kind = Tag(d.Kind), DocumentId = d.Id, Number = d.Number, ClientName = d.Client })
                .ToList();

        /// <summary>
        /// Refuses a change to customer-document lines that would undo a purchase.
        /// <paramref name="newQuantities"/> maps line id → its quantity after the
        /// change (0 = removed or cancelled). A line a purchase row points at
        /// cannot be removed, and no trail may end up asking for less than is bought.
        /// </summary>
        public static async Task AssertCanChangeAsync(AppDbContext db, int companyId, DemandKind kind, IReadOnlyDictionary<int, decimal> newQuantities)
        {
            if (newQuantities.Count == 0) return;
            if (!await db.PurchaseItemSources.AnyAsync(s => s.PurchaseItem.PurchaseBill.CompanyId == companyId)) return;
            var ids = newQuantities.Keys.ToList();
            var removed = newQuantities.Where(kv => kv.Value <= 0).Select(kv => kv.Key).ToList();
            if (removed.Count > 0)
            {
                var referenced = kind switch
                {
                    DemandKind.Order => db.PurchaseItemSources.Where(s => s.SalesOrderItemId != null && removed.Contains(s.SalesOrderItemId.Value)).Select(s => s.SalesOrderItemId!.Value),
                    DemandKind.Challan => db.PurchaseItemSources.Where(s => s.DeliveryItemId != null && removed.Contains(s.DeliveryItemId.Value)).Select(s => s.DeliveryItemId!.Value),
                    _ => db.PurchaseItemSources.Where(s => s.InvoiceItemId != null && removed.Contains(s.InvoiceItemId.Value)).Select(s => s.InvoiceItemId!.Value),
                };
                var hit = await referenced.FirstOrDefaultAsync();
                if (hit != 0)
                {
                    var demand = new CustomerDemand(db);
                    await demand.LoadAsync(companyId);
                    var line = demand.TrailOf(new DemandRef(kind, hit))?.Members.FirstOrDefault(m => m.Kind == kind && m.Id == hit);
                    throw new InvalidOperationException($"\"{line?.Description ?? "A line"}\" has been purchased and cannot be removed or cancelled. Delete or change that purchase first.");
                }
            }

            var d = new CustomerDemand(db);
            await d.LoadAsync(companyId);
            await d.LoadBoughtAsync(null);
            foreach (var t in ids.Select(id => d.TrailOf(new DemandRef(kind, id))).Where(t => t is { Bought: > 0 }).Distinct())
            {
                decimal Q(Line l) => l.Kind == kind && newQuantities.TryGetValue(l.Id, out var q) ? Math.Max(q, 0) : l.Qty;
                var toBuy = Math.Max(t!.Order == null ? 0 : Q(t.Order), Math.Max(t.Challans.Sum(Q), t.Bills.Sum(Q)));
                if (toBuy + 0.0001m < t.Bought)
                    throw new InvalidOperationException(
                        $"\"{t.Latest.Description}\" has {t.Bought:0.####} {t.Latest.Unit} purchased; it cannot go below that.".Replace("  ", " "));
            }
        }

        /// <summary>
        /// Lines left to buy, grouped into cards by <c>query.GroupBy</c>:
        /// "latest" (each trail under its newest document), "order", "challan" or "bill".
        /// Only document kinds in <paramref name="viewable"/> are shown.
        /// </summary>
        public List<AwaitingCardDto> AwaitingCards(AwaitingLinesQuery q, HashSet<int>? allowedDivisionIds, ISet<DemandKind> viewable)
        {
            var term = q.Search?.Trim().ToLowerInvariant();
            var forKind = ParseKind(q.ForKind);
            var group = (q.GroupBy ?? "latest").ToLowerInvariant();
            var cards = new Dictionary<string, AwaitingCardDto>();
            var cardOrder = new Dictionary<string, (DateTime, int)>();

            foreach (var t in _trails.Values)
            {
                if (t.Left <= 0.0001m) continue;
                var planned = t.Planned;
                if (q.SupplierId != null && !q.AllSuppliers && planned != null && planned.SupplierId != q.SupplierId) continue;
                if (forKind != null && !t.Members.Any(m => m.Kind == forKind && m.Doc.Id == q.ForId)) continue;

                Line? link = group switch
                {
                    "order" => t.Order,
                    "bill" => t.Bills.OrderByDescending(b => b.Id).FirstOrDefault(),
                    "challan" => t.Challans.OrderByDescending(c => c.Id).FirstOrDefault(),
                    _ => t.Latest,
                };
                var none = link == null;
                link ??= t.Members.First(m => t.Key == $"{(m.Kind == DemandKind.Order ? "o" : m.Kind == DemandKind.Challan ? "c" : "b")}:{m.Id}");
                if (!viewable.Contains(link.Kind)) continue;
                if (link.Doc.DivisionId is int div && allowedDivisionIds != null && !allowedDivisionIds.Contains(div)) continue;

                // Tags name only documents the caller may see: viewable kinds, allowed divisions.
                var tags = Tags(t, viewable).Where(g => allowedDivisionIds == null
                    || t.Members.First(m => Tag(m.Doc.Kind) == g.Kind && m.Doc.Id == g.DocumentId).Doc.DivisionId is not int gd
                    || allowedDivisionIds.Contains(gd)).ToList();
                if (!string.IsNullOrEmpty(term)
                    && !tags.Any(g => g.Number.ToString() == term || g.ClientName.ToLowerInvariant().Contains(term))
                    && !t.Members.Any(m => viewable.Contains(m.Kind) && m.Description.ToLowerInvariant().Contains(term) || (m.Doc.Po ?? "").ToLowerInvariant().Contains(term)))
                    continue;

                var cardKey = none ? (group == "order" ? "none-order" : group == "challan" ? "none-challan" : "none-bill") : $"{Tag(link.Doc.Kind)}:{link.Doc.Id}";
                if (!cards.TryGetValue(cardKey, out var card))
                {
                    card = none
                        ? new AwaitingCardDto { Kind = cardKey, Title = group == "order" ? "No sales order" : group == "challan" ? "Not delivered yet" : "Not billed yet" }
                        : new AwaitingCardDto
                        {
                            Kind = Tag(link.Doc.Kind),
                            DocumentId = link.Doc.Id,
                            Number = link.Doc.Number,
                            Title = $"{(link.Doc.Kind == DemandKind.Order ? "Sales Order" : link.Doc.Kind == DemandKind.Challan ? "Challan" : "Bill")} #{link.Doc.Number}",
                            ClientName = link.Doc.Client,
                            Date = link.Doc.Date,
                            PoNumber = string.IsNullOrWhiteSpace(link.Doc.Po) ? null : link.Doc.Po,
                        };
                    cards[cardKey] = card;
                    cardOrder[cardKey] = none ? (DateTime.MinValue, 0) : (link.Doc.Date ?? DateTime.MinValue, link.Doc.Id);
                }
                if (!none)
                    foreach (var tag in tags.Where(g => !(g.Kind == card.Kind && g.DocumentId == card.DocumentId)))
                        if (!card.From.Any(f => f.Kind == tag.Kind && f.DocumentId == tag.DocumentId)) card.From.Add(tag);

                // The newest line the caller may see names the goods.
                var latest = viewable.Contains(t.Latest.Kind) ? t.Latest : link;
                card.Lines.Add(new AwaitingLineDto
                {
                    Kind = Tag(link.Kind),
                    LineId = link.Id,
                    TrailKey = t.Key,
                    Stage = t.Bills.Count > 0 ? "Billed" : t.Challans.Count > 0 ? "Delivered" : "Ordered",
                    Description = latest.Description,
                    ItemTypeId = latest.ItemTypeId,
                    ItemTypeName = latest.ItemTypeName,
                    NonInventoryItemId = latest.NonInventoryItemId,
                    Unit = latest.Unit,
                    Ordered = t.Ordered,
                    Delivered = t.Delivered,
                    Billed = t.Billed,
                    Bought = t.Bought,
                    Left = t.Left,
                    Cost = t.Cost,
                    PlannedSupplierId = planned?.SupplierId,
                    PlannedSupplierName = planned?.SupplierName,
                    Trail = tags,
                });
            }

            return cards
                .OrderBy(c => c.Key.StartsWith("none-") ? 1 : 0)
                .ThenByDescending(c => cardOrder[c.Key].Item1).ThenByDescending(c => cardOrder[c.Key].Item2)
                .Take(100)
                .Select(c => { c.Value.Lines.Sort((a, b) => a.LineId.CompareTo(b.LineId)); return c.Value; })
                .ToList();
        }
    }
}
