// src/pages/public/LandingPage.jsx
import { useEffect, useState, useRef } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import CountUp from "react-countup";
import { useInView } from "react-intersection-observer";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Navigation, Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import {
  MdPrecisionManufacturing,
  MdSettingsInputComponent,
  MdTune,
  MdSpeed,
  MdConstruction,
  MdInventory2,
  MdVerified,
  MdBuild,
  MdLocalShipping,
} from "react-icons/md";
import {
  FiMail,
  FiPhone,
  FiMapPin,
  FiSend,
  FiUser,
  FiMessageSquare,
  FiChevronDown,
} from "react-icons/fi";
import "./LandingPage.css";

/* ------------------------------------------------------------------ */
/*  Data                                                                 */
/* ------------------------------------------------------------------ */

const STATS = [
  { end: 15, suffix: "+", label: "Years Experience" },
  { end: 50, suffix: "+", label: "Products" },
  { end: 20, suffix: "+", label: "Brands" },
  { end: 14, suffix: "+", label: "Clients" },
];

const CATEGORIES = [
  {
    icon: <MdPrecisionManufacturing />,
    title: "Pneumatic Equipment",
    desc: "Push-in fittings, air cylinders, FRL units, solenoid valves and complete pneumatic systems.",
  },
  {
    icon: <MdSettingsInputComponent />,
    title: "Hydraulic Systems",
    desc: "Hydraulic cylinders, hoses, couplings and complete hydraulic circuit components.",
  },
  {
    icon: <MdTune />,
    title: "Industrial Valves",
    desc: "Ball valves, gate valves, butterfly valves and solenoid-operated control valves.",
  },
  {
    icon: <MdSpeed />,
    title: "Pressure & Temperature",
    desc: "Gauges, transmitters, thermometers and industrial instrumentation from top global brands.",
  },
  {
    icon: <MdConstruction />,
    title: "SS / Brass / MS Fittings",
    desc: "Stainless steel, brass and mild steel compression fittings in all sizes and configurations.",
  },
  {
    icon: <MdInventory2 />,
    title: "General Order Supplies",
    desc: "Flexible industrial procurement for diverse maintenance, repair and operations requirements.",
  },
];

/*  Optional metadata for known categories.
    Any folder NOT listed here still appears as a tab —
    its label is auto-generated from the folder name
    (e.g. "my-new-category" → "My New Category").               */
const CATEGORY_META = {
  pneumatic:              { label: "Pneumatic Accessories", products: ["Push-in Fittings (Straight / Elbow / Tee)","Pneumatic Tubing (PA / PU / Nylon)","Quick Connectors & Couplings","Flow Control Valves","Check Valves","Mufflers & Silencers","Pneumatic Manifolds"] },
  frl:                    { label: "Air Service / FRL",     products: ["Filter-Regulator-Lubricator (FRL) Units","Air Filters (Particulate & Coalescing)","Precision Regulators","Line Lubricators","Air Dryers","Service Units (Modular)"] },
  cylinders:              { label: "Cylinders",             products: ["Double Acting Cylinders (Standard / Compact)","Single Acting Cylinders","Round Body (Tie-rod) Cylinders","Profile Cylinders","Rodless Cylinders","Cylinder Repair Kits"] },
  valves:                 { label: "Valves",                products: ["5/2 & 5/3 Solenoid Valves","3/2 Way Valves","Directional Control Valves","Valve Manifolds","Pneumatic & Hydraulic Ball Valves","Proportional Valves"] },
  hydraulics:             { label: "Hydraulics",            products: ["Hydraulic Cylinders","Hydraulic Hoses & Fittings","Hydraulic Pumps","Control Valves","Pressure Gauges for Hydraulics","Hydraulic Seals & Repair Kits"] },
  "industrial-valves":    { label: "Industrial Valves",     products: ["SS Ball Valves (Manual & Actuated)","Gate Valves","Globe Valves","Butterfly Valves","Needle Valves","Safety Relief Valves"] },
  "pressure-instruments": { label: "Pressure Instruments",  products: ["Bourdon Tube Pressure Gauges","Differential Pressure Gauges","Pressure Transmitters","Pressure Switches","Diaphragm Seals","Manometers"] },
  "temperature-instruments": { label: "Temperature Instruments", products: ["Bi-metal Thermometers","Temperature Transmitters","Thermocouples (Type J/K/T)","RTD Sensors (PT100)","Temperature Switches","Digital Indicators"] },
  "ss-fittings":          { label: "SS Fittings",           products: ["SS Compression Fittings (Swagelok-type)","SS Tube Fittings (Straight / Elbow / Tee / Cross)","SS NPT Adapters","SS Unions & Couplings","SS Ferrule Sets","High-Pressure Fittings"] },
  "brass-fittings":       { label: "Brass Fittings",        products: ["Brass Compression Fittings","Brass Push-in Fittings","Brass NPT / BSP Fittings","Brass Barb Fittings","Brass Plug / Cap / Bush","Brass Unions & Nipples"] },
  "ms-fittings":          { label: "MS Fittings",           products: ["MS Compression Fittings","MS Pipe Fittings (Tee / Elbow / Reducer)","MS Flanges","MS Unions","MS Hex Nipples","MS Tube Connectors"] },
  "repair-kits":          { label: "Repair Kits",           products: ["Pneumatic Cylinder Repair Kits","FRL Unit Service Kits","Solenoid Valve Coils & Seals","O-Ring Assortments","Seal Kits (NBR / Viton / PTFE)","Diaphragm & Membrane Kits"] },
};

/** Convert folder name to display label: "my-new-category" → "My New Category" */
function folderToLabel(folder) {
  return folder
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const BRANDS = [
  "Legris", "SMC", "Norgren", "WIKA", "Swagelok", "FESTO",
  "CKD", "Sang-A", "Parker", "Nuova Fima", "Burkert", "AirTac",
  "ASCO", "MAC", "WABCO", "Southman", "Whitey", "NAB",
  "SNS", "Nitta Moore", "Danfoss", "JUMO", "Wade",
  "Imperial England", "EAO", "KTZ",
];

const CLIENTS = [
  { name: "Mekotex", industry: "Textile" },
  { name: "Tata Pakistan", industry: "Industrial" },
  { name: "Artistic Denim", industry: "Textile" },
  { name: "Medicam Group", industry: "Pharma" },
  { name: "Sapphire", industry: "Textile" },
  { name: "Siddiqsons", industry: "Textile" },
  { name: "Lotte Kolson", industry: "Food" },
  { name: "Continental Biscuits", industry: "Food" },
  { name: "Soorty", industry: "Textile" },
  { name: "Mundia Export", industry: "Textile" },
  { name: "Artistic Garment", industry: "Textile" },
  { name: "Crescent Bahuman", industry: "Textile" },
  { name: "Lucky Textile", industry: "Textile" },
  { name: "Gul Ahmed", industry: "Textile" },
];

const WHY_CARDS = [
  {
    icon: <MdVerified />,
    title: "Quality Products",
    desc: "We source exclusively from premium global brands, ensuring genuine parts with full traceability and manufacturer warranties.",
  },
  {
    icon: <MdBuild />,
    title: "Expert Repair & Servicing",
    desc: "Skilled in-house servicing of pneumatic cylinders, FRL units, solenoid valves and complete pneumatic assemblies.",
  },
  {
    icon: <MdLocalShipping />,
    title: "Reliable Supply Chain",
    desc: "Timely delivery across Karachi and Pakistan, competitive pricing, and a well-stocked inventory for fast dispatch.",
  },
];

const INDUSTRY_COLORS = {
  Textile:    { bg: "#e3f2fd", color: "#0d47a1" },
  Industrial: { bg: "#fce4ec", color: "#880e4f" },
  Pharma:     { bg: "#e8f5e9", color: "#1b5e20" },
  Food:       { bg: "#fff8e1", color: "#e65100" },
};

/* ------------------------------------------------------------------ */
/*  Animated stat counter                                               */
/* ------------------------------------------------------------------ */
function StatCounter({ end, suffix, label }) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.3 });
  return (
    <div className="lp-stat" ref={ref}>
      <span className="lp-stat__number">
        {inView ? <CountUp end={end} duration={2.2} /> : "0"}
        {suffix}
      </span>
      <span className="lp-stat__label">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LandingPage                                                         */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [productTabs, setProductTabs] = useState([]); // dynamic categories from API
  const [categoryImages, setCategoryImages] = useState({}); // { folder: [url, ...] }
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", message: "" });
  const [formStatus, setFormStatus] = useState(null); // 'sending' | 'sent' | 'error'
  const tabsRef = useRef(null);

  const apiBase = window._env_?.API_URL || "/api";

  // Initialize AOS
  useEffect(() => {
    AOS.init({
      duration: 700,
      easing: "ease-out-cubic",
      once: true,
      offset: 80,
    });
    return () => AOS.refresh();
  }, []);

  // Fetch category list from API on mount
  useEffect(() => {
    fetch(`${apiBase}/product-images`)
      .then((res) => (res.ok ? res.json() : []))
      .then((categories) => {
        const tabs = categories.map((cat) => {
          const meta = CATEGORY_META[cat.name];
          return {
            id: cat.name,
            label: meta?.label || folderToLabel(cat.name),
            folder: cat.name,
            products: meta?.products || [],
            imageCount: cat.imageCount,
          };
        });
        setProductTabs(tabs);
      })
      .catch(() => setProductTabs([]));
  }, [apiBase]);

  // Fetch images for the active tab's category folder
  useEffect(() => {
    if (productTabs.length === 0) return;
    const folder = productTabs[activeTab]?.folder;
    if (!folder || categoryImages[folder]) return;
    fetch(`${apiBase}/product-images/${folder}`)
      .then((res) => res.ok ? res.json() : [])
      .then((images) => {
        setCategoryImages((prev) => ({ ...prev, [folder]: images }));
      })
      .catch(() => {
        setCategoryImages((prev) => ({ ...prev, [folder]: [] }));
      });
  }, [activeTab, apiBase, categoryImages, productTabs]);

  // Scroll to active tab button
  useEffect(() => {
    if (!tabsRef.current) return;
    const btn = tabsRef.current.querySelector(`[data-tab="${activeTab}"]`);
    if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeTab]);

  const handleFormChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    setFormStatus("sending");
    // Simulate sending (replace with actual API call)
    setTimeout(() => setFormStatus("sent"), 1500);
  };

  const activeProduct = productTabs[activeTab] || { id: "", label: "", folder: "", products: [] };
  const activeImages = categoryImages[activeProduct.folder] || [];

  /* Duplicate brands for seamless scroll marquee */
  const brandsRow1 = [...BRANDS.slice(0, 13), ...BRANDS.slice(0, 13)];
  const brandsRow2 = [...BRANDS.slice(13), ...BRANDS.slice(13)];

  return (
    <div className="lp-page">
      {/* ============================================================ */}
      {/*  SECTION 1 — HERO                                            */}
      {/* ============================================================ */}
      <section id="home" className="lp-hero">
        {/* Animated background shapes */}
        <div className="lp-hero__shapes" aria-hidden="true">
          <span className="lp-shape lp-shape--1" />
          <span className="lp-shape lp-shape--2" />
          <span className="lp-shape lp-shape--3" />
          <span className="lp-shape lp-shape--4" />
          <span className="lp-shape lp-shape--5" />
          <span className="lp-shape lp-shape--gear lp-shape--gear-1" />
          <span className="lp-shape lp-shape--gear lp-shape--gear-2" />
        </div>

        <div className="lp-hero__content">
          <p className="lp-hero__eyebrow" data-aos="fade-down">
            Karachi, Pakistan &bull; Est. 2009
          </p>
          <h1 className="lp-hero__title" data-aos="fade-up" data-aos-delay="100">
            HAKIMI<br />TRADERS
          </h1>
          <p className="lp-hero__subtitle" data-aos="fade-up" data-aos-delay="200">
            Specialist of Pneumatics Fitting, Equipments &amp;<br />
            General Order Suppliers
          </p>
          <div className="lp-hero__ctas" data-aos="fade-up" data-aos-delay="320">
            <a href="#products" className="lp-btn lp-btn--primary" onClick={(e) => { e.preventDefault(); document.querySelector("#products")?.scrollIntoView({ behavior: "smooth" }); }}>
              Explore Products
            </a>
            <a href="#contact" className="lp-btn lp-btn--outline" onClick={(e) => { e.preventDefault(); document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" }); }}>
              Contact Us
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="lp-hero__scroll-indicator" aria-hidden="true">
          <FiChevronDown className="lp-hero__scroll-icon" />
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 2 — ABOUT US                                        */}
      {/* ============================================================ */}
      <section id="about" className="lp-about">
        <div className="lp-container">
          <div className="lp-about__grid">
            <div className="lp-about__text" data-aos="fade-right">
              <span className="lp-section-eyebrow">Who We Are</span>
              <h2 className="lp-section-title">About Hakimi Traders</h2>
              <p>
                Hakimi Traders is a Karachi-based specialist supplier of pneumatic, hydraulic
                and industrial equipment, serving Pakistan&apos;s leading manufacturers since 2009.
                We supply genuine components from over 20 internationally recognized brands —
                giving our clients reliable, efficient and cost-effective industrial solutions.
              </p>
              <p>
                From push-in fittings and FRL units to solenoid valves, pressure instruments,
                and complete cylinder assemblies — our inventory and expert team ensure you get
                exactly what your plant needs, when you need it.
              </p>
              <div className="lp-about__badges">
                <span className="lp-badge">NTN: 4228937-8</span>
                <span className="lp-badge">STRN: 3277876175852</span>
                <span className="lp-badge lp-badge--teal">ISO-Grade Sourcing</span>
              </div>
            </div>

            <div className="lp-about__visual" data-aos="fade-left" data-aos-delay="150">
              <div className="lp-about__card-grid">
                {CATEGORIES.slice(0, 4).map((cat) => (
                  <div key={cat.title} className="lp-about__mini-card">
                    <span className="lp-about__mini-icon">{cat.icon}</span>
                    <span>{cat.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="lp-stats-bar" data-aos="fade-up" data-aos-delay="100">
            {STATS.map((s) => (
              <StatCounter key={s.label} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 3 — PRODUCT CATEGORIES                              */}
      {/* ============================================================ */}
      <section id="categories" className="lp-categories">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow">What We Supply</span>
            <h2 className="lp-section-title">Product Categories</h2>
            <p className="lp-section-sub">
              Comprehensive industrial supply across six core product verticals
            </p>
          </div>

          <div className="lp-categories__grid">
            {CATEGORIES.map((cat, i) => (
              <article
                key={cat.title}
                className="lp-cat-card"
                data-aos="fade-up"
                data-aos-delay={i * 80}
                onClick={() => document.querySelector("#products")?.scrollIntoView({ behavior: "smooth" })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && document.querySelector("#products")?.scrollIntoView({ behavior: "smooth" })}
                aria-label={`${cat.title} - click to see products`}
              >
                <div className="lp-cat-card__icon-wrap" aria-hidden="true">
                  {cat.icon}
                </div>
                <h3 className="lp-cat-card__title">{cat.title}</h3>
                <p className="lp-cat-card__desc">{cat.desc}</p>
                <span className="lp-cat-card__cta">View Products &rarr;</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 4 — PRODUCTS SHOWCASE                               */}
      {/* ============================================================ */}
      <section id="products" className="lp-products">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow">Our Range</span>
            <h2 className="lp-section-title lp-section-title--light">Products Showcase</h2>
            <p className="lp-section-sub lp-section-sub--light">
              Browse our full catalogue of pneumatic, hydraulic and industrial components
            </p>
          </div>

          {/* Tab navigation */}
          {productTabs.length > 0 && (<>
          <div className="lp-products__tabs-wrap" data-aos="fade-up" data-aos-delay="80">
            <div className="lp-products__tabs" ref={tabsRef} role="tablist" aria-label="Product categories">
              {productTabs.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`lp-products__tab${activeTab === i ? " lp-products__tab--active" : ""}`}
                  onClick={() => setActiveTab(i)}
                  data-tab={i}
                  role="tab"
                  aria-selected={activeTab === i}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab panel */}
          <div
            key={activeProduct.id}
            className="lp-products__panel"
            role="tabpanel"
            id={`tabpanel-${activeProduct.id}`}
            aria-labelledby={`tab-${activeProduct.id}`}
          >
            <div className="lp-products__panel-inner">
              {/* Swiper carousel */}
              <div className="lp-products__carousel" data-aos="fade-right">
                {activeImages.length > 0 ? (
                <Swiper
                  key={activeProduct.folder}
                  modules={[Autoplay, Navigation, Pagination]}
                  spaceBetween={0}
                  slidesPerView={1}
                  navigation
                  pagination={{ clickable: true }}
                  autoplay={{ delay: 3500, disableOnInteraction: false }}
                  loop={activeImages.length > 1}
                  className="lp-swiper"
                >
                  {activeImages.map((src, idx) => (
                    <SwiperSlide key={src}>
                      <div className="lp-swiper__slide">
                        <img
                          src={src}
                          alt={`${activeProduct.label} product image ${idx + 1}`}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    </SwiperSlide>
                  ))}
                </Swiper>
                ) : (
                  <div className="lp-swiper__slide" style={{ aspectRatio: "4/3", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>Loading images...</span>
                  </div>
                )}
              </div>

              {/* Product list */}
              <div className="lp-products__list" data-aos="fade-left" data-aos-delay="100">
                <h3 className="lp-products__list-title">{activeProduct.label}</h3>
                <ul className="lp-products__items" role="list">
                  {activeProduct.products.map((p) => (
                    <li key={p} className="lp-products__item">
                      <span className="lp-products__item-dot" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
                <a
                  href="#contact"
                  className="lp-btn lp-btn--teal lp-btn--sm"
                  onClick={(e) => { e.preventDefault(); document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" }); }}
                >
                  Enquire About This Category
                </a>
              </div>
            </div>
          </div>
          </>)}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 5 — TRUSTED BRANDS                                  */}
      {/* ============================================================ */}
      <section id="brands" className="lp-brands">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow lp-section-eyebrow--light">Our Partners</span>
            <h2 className="lp-section-title lp-section-title--light">Trusted Brands</h2>
            <p className="lp-section-sub lp-section-sub--light">
              We are authorized stockists and resellers for over 20 leading international manufacturers
            </p>
          </div>
        </div>

        {/* Row 1 — scrolls left */}
        <div className="lp-brands__track-wrap" aria-label="Brand logos row 1">
          <div className="lp-brands__track lp-brands__track--left">
            {brandsRow1.map((b, i) => (
              <div key={`${b}-${i}`} className="lp-brand-badge">
                {b}
              </div>
            ))}
          </div>
        </div>

        {/* Row 2 — scrolls right */}
        <div className="lp-brands__track-wrap" aria-label="Brand logos row 2">
          <div className="lp-brands__track lp-brands__track--right">
            {brandsRow2.map((b, i) => (
              <div key={`${b}-${i}`} className="lp-brand-badge">
                {b}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 6 — OUR CLIENTS                                     */}
      {/* ============================================================ */}
      <section id="clients" className="lp-clients">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow">Who Trusts Us</span>
            <h2 className="lp-section-title">Our Clients</h2>
            <p className="lp-section-sub">
              Proudly serving Pakistan&apos;s leading textile, pharmaceutical, food and industrial companies
            </p>
          </div>

          <div className="lp-clients__grid">
            {CLIENTS.map((c, i) => {
              const style = INDUSTRY_COLORS[c.industry] ?? { bg: "#f3e5f5", color: "#4a148c" };
              return (
                <div
                  key={c.name}
                  className="lp-client-card"
                  data-aos="zoom-in"
                  data-aos-delay={i * 50}
                >
                  <div className="lp-client-card__initials" aria-hidden="true">
                    {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                  <span className="lp-client-card__name">{c.name}</span>
                  <span
                    className="lp-client-card__industry"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {c.industry}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 7 — WHY CHOOSE US                                   */}
      {/* ============================================================ */}
      <section className="lp-why">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow lp-section-eyebrow--light">Our Advantage</span>
            <h2 className="lp-section-title lp-section-title--light">Why Choose Hakimi Traders?</h2>
          </div>

          <div className="lp-why__grid">
            {WHY_CARDS.map((card, i) => (
              <div
                key={card.title}
                className="lp-why-card"
                data-aos="fade-up"
                data-aos-delay={i * 120}
              >
                <div className="lp-why-card__icon" aria-hidden="true">
                  {card.icon}
                </div>
                <h3 className="lp-why-card__title">{card.title}</h3>
                <p className="lp-why-card__desc">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECTION 8 — CONTACT                                         */}
      {/* ============================================================ */}
      <section id="contact" className="lp-contact">
        <div className="lp-container">
          <div className="lp-section-header" data-aos="fade-up">
            <span className="lp-section-eyebrow">Get In Touch</span>
            <h2 className="lp-section-title">Contact Us</h2>
            <p className="lp-section-sub">
              Send us an enquiry or visit our office in Karachi
            </p>
          </div>

          <div className="lp-contact__grid">
            {/* Left — Form */}
            <div className="lp-contact__form-wrap" data-aos="fade-right">
              <form
                className="lp-contact__form"
                onSubmit={handleFormSubmit}
                noValidate
                aria-label="Contact form"
              >
                <div className="lp-form-group">
                  <label htmlFor="cf-name">
                    <FiUser aria-hidden="true" /> Full Name
                  </label>
                  <input
                    id="cf-name"
                    type="text"
                    name="name"
                    placeholder="Your full name"
                    value={formData.name}
                    onChange={handleFormChange}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="lp-form-group">
                  <label htmlFor="cf-email">
                    <FiMail aria-hidden="true" /> Email Address
                  </label>
                  <input
                    id="cf-email"
                    type="email"
                    name="email"
                    placeholder="your@email.com"
                    value={formData.email}
                    onChange={handleFormChange}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="lp-form-group">
                  <label htmlFor="cf-phone">
                    <FiPhone aria-hidden="true" /> Phone Number
                  </label>
                  <input
                    id="cf-phone"
                    type="tel"
                    name="phone"
                    placeholder="03XX-XXXXXXX"
                    value={formData.phone}
                    onChange={handleFormChange}
                    autoComplete="tel"
                  />
                </div>
                <div className="lp-form-group lp-form-group--full">
                  <label htmlFor="cf-message">
                    <FiMessageSquare aria-hidden="true" /> Message
                  </label>
                  <textarea
                    id="cf-message"
                    name="message"
                    rows={5}
                    placeholder="Tell us about your requirements..."
                    value={formData.message}
                    onChange={handleFormChange}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="lp-btn lp-btn--primary lp-btn--send"
                  disabled={formStatus === "sending" || formStatus === "sent"}
                >
                  {formStatus === "sending" ? (
                    "Sending..."
                  ) : formStatus === "sent" ? (
                    "Message Sent!"
                  ) : (
                    <>
                      <FiSend aria-hidden="true" /> Send Enquiry
                    </>
                  )}
                </button>

                {formStatus === "sent" && (
                  <p className="lp-form-success" role="status">
                    Thank you! We&apos;ll be in touch shortly.
                  </p>
                )}
              </form>
            </div>

            {/* Right — Contact info + Map */}
            <div className="lp-contact__info" data-aos="fade-left" data-aos-delay="100">
              <div className="lp-contact__cards">
                <div className="lp-contact-info-card">
                  <FiMail className="lp-contact-info-card__icon" aria-hidden="true" />
                  <div>
                    <strong>Email</strong>
                    <a href="mailto:hakimitraders111@gmail.com">
                      hakimitraders111@gmail.com
                    </a>
                  </div>
                </div>

                <div className="lp-contact-info-card">
                  <FiPhone className="lp-contact-info-card__icon" aria-hidden="true" />
                  <div>
                    <strong>Director — Sakina Dossaji</strong>
                    <a href="tel:+923355285380">0335-5285380</a>
                  </div>
                </div>

                <div className="lp-contact-info-card">
                  <FiPhone className="lp-contact-info-card__icon" aria-hidden="true" />
                  <div>
                    <strong>Technical — Murtaza</strong>
                    <a href="tel:+923313368883">0331-3368883</a>
                  </div>
                </div>

                <div className="lp-contact-info-card lp-contact-info-card--address">
                  <FiMapPin className="lp-contact-info-card__icon" aria-hidden="true" />
                  <div>
                    <strong>Office Address</strong>
                    <address>
                      Shop# 21, Falak Corporate City,<br />
                      Talpur Road, opposite City Post Office,<br />
                      Karachi, Pakistan
                    </address>
                  </div>
                </div>
              </div>

              {/* Google Maps embed */}
              <div className="lp-contact__map">
                <iframe
                  title="Hakimi Traders location — Falak Corporate City, Talpur Road, Karachi"
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3619.8!2d67.0099!3d24.8607!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3eb33e2c0000003%3A0x0!2sTalpur%20Rd%2C%20Karachi!5e0!3m2!1sen!2s!4v1"
                  width="100%"
                  height="220"
                  style={{ border: 0, borderRadius: "12px" }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
