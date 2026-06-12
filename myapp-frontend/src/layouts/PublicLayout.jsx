// src/layouts/PublicLayout.jsx
// Public site shell: fixed glass navbar (with scroll progress + section
// spy), full-screen mobile drawer, footer with email CTA, back-to-top FAB.
import { useState, useEffect, useRef } from "react";
import { Outlet, Link } from "react-router-dom";
import {
  FiMenu,
  FiX,
  FiMail,
  FiPhone,
  FiMapPin,
  FiLogIn,
  FiArrowUp,
  FiArrowUpRight,
} from "react-icons/fi";
import BrandMark from "../Components/BrandMark";
import "./PublicLayout.css";

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "About", href: "#about" },
  { label: "Products", href: "#products" },
  { label: "Brands", href: "#brands" },
  { label: "Clients", href: "#clients" },
  { label: "Contact", href: "#contact" },
];

export default function PublicLayout() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState("#home");
  const [showTop, setShowTop] = useState(false);
  const sentinelRef = useRef(null);

  // Page title + description for the public site only (admin keeps its own)
  useEffect(() => {
    const prevTitle = document.title;
    document.title =
      "Hakimi Traders — Pneumatic, Hydraulic & Industrial Equipment | Karachi";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  // IntersectionObserver: navbar becomes solid when sentinel leaves viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Scroll progress (--sp drives the navbar hairline + FAB ring)
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        doc.style.setProperty("--sp", p.toFixed(4));
        setShowTop(window.scrollY > 520);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Section spy — highlights the nav link for the section in view
  useEffect(() => {
    const els = NAV_LINKS
      .map((l) => document.getElementById(l.href.slice(1)))
      .filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActive(`#${en.target.id}`);
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Close drawer on resize to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setDrawerOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const handleNavClick = (e, href) => {
    e.preventDefault();
    setDrawerOpen(false);
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="pl-shell">
      {/* Scroll sentinel — sits at very top of page */}
      <div ref={sentinelRef} className="pl-sentinel" aria-hidden="true" />

      {/* ================================================================ */}
      {/*  NAVBAR                                                          */}
      {/* ================================================================ */}
      <header className={`pl-navbar${scrolled ? " pl-navbar--solid" : ""}`} role="banner">
        <div className="pl-navbar__inner">
          {/* Logo */}
          <a
            href="#home"
            className="pl-navbar__logo"
            onClick={(e) => handleNavClick(e, "#home")}
            aria-label="Hakimi Traders - Home"
          >
            <BrandMark size={30} className="pl-navbar__logo-mark" />
            <span className="pl-navbar__logo-text">
              HAKIMI<em>TRADERS</em>
            </span>
          </a>

          {/* Desktop nav */}
          <nav className="pl-navbar__nav" role="navigation" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`pl-navbar__link${active === link.href ? " pl-navbar__link--active" : ""}`}
                onClick={(e) => handleNavClick(e, link.href)}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Right actions */}
          <div className="pl-navbar__actions">
            <Link to="/login" className="pl-navbar__login-btn" aria-label="System Login">
              <FiLogIn aria-hidden="true" />
              <span>System Login</span>
            </Link>

            {/* Hamburger (mobile) */}
            <button
              type="button"
              className="pl-navbar__hamburger"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <FiMenu size={24} />
            </button>
          </div>
        </div>

        {/* Reading progress hairline */}
        <span className="pl-navbar__progress" aria-hidden="true" />
      </header>

      {/* ================================================================ */}
      {/*  MOBILE DRAWER                                                   */}
      {/* ================================================================ */}
      <div
        className={`pl-drawer-overlay${drawerOpen ? " pl-drawer-overlay--visible" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <nav
        className={`pl-drawer${drawerOpen ? " pl-drawer--open" : ""}`}
        role="navigation"
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
      >
        <div className="pl-drawer__bg" aria-hidden="true" />
        <div className="pl-drawer__header">
          <span className="pl-drawer__logo">
            <BrandMark size={26} />
            HAKIMI TRADERS
          </span>
          <button
            type="button"
            className="pl-drawer__close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
          >
            <span>Close</span>
            <FiX size={22} />
          </button>
        </div>
        <div className="pl-drawer__links">
          {NAV_LINKS.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              className="pl-drawer__link"
              onClick={(e) => handleNavClick(e, link.href)}
            >
              <span className="pl-drawer__link-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {link.label}
            </a>
          ))}
          <Link
            to="/login"
            className="pl-drawer__login-btn"
            onClick={() => setDrawerOpen(false)}
          >
            <FiLogIn aria-hidden="true" />
            System Login
          </Link>
        </div>
      </nav>

      {/* ================================================================ */}
      {/*  PAGE CONTENT                                                    */}
      {/* ================================================================ */}
      <main id="main-content">
        <Outlet />
      </main>

      {/* ================================================================ */}
      {/*  FOOTER                                                          */}
      {/* ================================================================ */}
      <footer className="pl-footer" role="contentinfo">
        {/* Email CTA band */}
        <div className="pl-footer__cta">
          <p className="pl-footer__cta-eyebrow">Start a conversation</p>
          <a className="pl-footer__cta-mail" href="mailto:hakimitraders111@gmail.com">
            hakimitraders111@gmail.com
            <FiArrowUpRight aria-hidden="true" />
          </a>
        </div>

        <div className="pl-footer__inner">
          {/* Column 1 — Company info */}
          <div className="pl-footer__col">
            <div className="pl-footer__brand">
              <BrandMark size={34} />
              <span className="pl-footer__brand-name">HAKIMI TRADERS</span>
            </div>
            <p className="pl-footer__tagline">
              Specialist of Pneumatics Fitting, Equipments &amp; General Order
              Suppliers — serving Pakistan&apos;s industry since 2009.
            </p>
            <p className="pl-footer__reg">
              NTN 4228937-8&ensp;·&ensp;STRN 3277876175852
            </p>
          </div>

          {/* Column 2 — Quick links */}
          <div className="pl-footer__col">
            <h3 className="pl-footer__heading">Quick links</h3>
            <ul className="pl-footer__links" role="list">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="pl-footer__link"
                    onClick={(e) => handleNavClick(e, link.href)}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3 — Contact */}
          <div className="pl-footer__col">
            <h3 className="pl-footer__heading">Contact</h3>
            <ul className="pl-footer__contact-list" role="list">
              <li>
                <FiMail className="pl-footer__contact-icon" aria-hidden="true" />
                <a href="mailto:hakimitraders111@gmail.com" className="pl-footer__link">
                  hakimitraders111@gmail.com
                </a>
              </li>
              <li>
                <FiPhone className="pl-footer__contact-icon" aria-hidden="true" />
                <a href="tel:+923355285380" className="pl-footer__link">
                  0335-5285380
                </a>
              </li>
              <li>
                <FiPhone className="pl-footer__contact-icon" aria-hidden="true" />
                <a href="tel:+923313368883" className="pl-footer__link">
                  0331-3368883
                </a>
              </li>
              <li className="pl-footer__address">
                <FiMapPin className="pl-footer__contact-icon" aria-hidden="true" />
                <address>
                  Shop# 21, Falak Corporate City,<br />
                  Talpur Road, opposite City Post Office,<br />
                  Karachi
                </address>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright bar */}
        <div className="pl-footer__bottom">
          <p>&copy; {new Date().getFullYear()} Hakimi Traders. All rights reserved.</p>
          <p className="pl-footer__bottom-tagline">
            Pneumatics &bull; Hydraulics &bull; Industrial Equipment
          </p>
        </div>
      </footer>

      {/* Back-to-top FAB with scroll-progress ring */}
      <button
        type="button"
        className={`pl-top${showTop ? " pl-top--show" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
      >
        <FiArrowUp aria-hidden="true" />
      </button>
    </div>
  );
}
