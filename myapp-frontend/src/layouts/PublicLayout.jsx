// src/layouts/PublicLayout.jsx
import { useState, useEffect, useRef } from "react";
import { Outlet, Link } from "react-router-dom";
import {
  FiMenu,
  FiX,
  FiMail,
  FiPhone,
  FiMapPin,
  FiLogIn,
} from "react-icons/fi";
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
  const sentinelRef = useRef(null);

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
    return () => { document.body.style.overflow = ""; };
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
            <span className="pl-navbar__logo-icon" aria-hidden="true">⚙</span>
            <span className="pl-navbar__logo-text">HAKIMI TRADERS</span>
          </a>

          {/* Desktop nav */}
          <nav className="pl-navbar__nav" role="navigation" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="pl-navbar__link"
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
        <div className="pl-drawer__header">
          <span className="pl-drawer__logo">HAKIMI TRADERS</span>
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
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="pl-drawer__link"
              onClick={(e) => handleNavClick(e, link.href)}
            >
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
        <div className="pl-footer__inner">
          {/* Column 1 — Company info */}
          <div className="pl-footer__col">
            <div className="pl-footer__brand">
              <span className="pl-footer__brand-icon" aria-hidden="true">⚙</span>
              <span className="pl-footer__brand-name">HAKIMI TRADERS</span>
            </div>
            <p className="pl-footer__tagline">
              Specialist of Pneumatics Fitting, Equipments &amp; General Order Suppliers
            </p>
            <p className="pl-footer__reg">
              <strong>NTN:</strong> 4228937-8 &nbsp;|&nbsp; <strong>STRN:</strong> 3277876175852
            </p>
          </div>

          {/* Column 2 — Quick links */}
          <div className="pl-footer__col">
            <h3 className="pl-footer__heading">Quick Links</h3>
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
            <h3 className="pl-footer__heading">Contact Us</h3>
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
          <p>
            &copy; {new Date().getFullYear()} Hakimi Traders. All rights reserved.
          </p>
          <p className="pl-footer__bottom-tagline">
            Pneumatics &bull; Hydraulics &bull; Industrial Equipment
          </p>
        </div>
      </footer>
    </div>
  );
}
