// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Field from "./BillTaxTreatmentField";
afterEach(cleanup);
it("adds no controls to a default-off company",()=>{const {container}=render(<Field enabled={false}/>);expect(container.textContent).toBe("");});
it("allows an enabled company to choose SRB",()=>{const change=vi.fn();render(<Field enabled value="FBR" onChange={change}/>);fireEvent.change(screen.getByLabelText("Tax treatment"),{target:{value:"SRB"}});expect(change).toHaveBeenCalledWith("SRB");});
it("keeps the SRB percentage editable",()=>{const rate=vi.fn();render(<Field enabled value="SRB" rate={15} onRateChange={rate}/>);const input=screen.getByLabelText("Non-FBR tax rate");expect(input.value).toBe("15");expect(input.disabled).toBe(false);fireEvent.change(input,{target:{value:"12.5"}});expect(rate).toHaveBeenCalledWith("12.5");});
it("shows a saved SRB bill even after the company setting is disabled",()=>{render(<Field enabled={false} value="SRB" rate={15}/>);expect(screen.getByLabelText("Tax treatment").value).toBe("SRB");});
it("locks no-tax rate and read-only bills",()=>{render(<Field enabled value="NoTax" rate={0} disabled/>);expect(screen.getByLabelText("Non-FBR tax rate").disabled).toBe(true);expect(screen.getByLabelText("Tax treatment").disabled).toBe(true);});
