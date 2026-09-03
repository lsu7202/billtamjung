import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import { MainCuts } from "./MainCuts";
import { Manual, TOTAL, FPS } from "./Manual";
import { GuideEdit, GuideQ1, GuideQ2, GuideQ3, TOTAL as G_TOTAL,
  TOTAL_Q1, TOTAL_Q2, TOTAL_Q3, FPS as G_FPS } from "./GuideEdit";

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={450} fps={30} width={1920} height={1080} />
    <Composition id="Cuts" component={MainCuts} durationInFrames={450} fps={30} width={1920} height={1080} />
    <Composition id="Manual" component={Manual} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="GuideEdit" component={GuideEdit} durationInFrames={G_TOTAL} fps={G_FPS} width={1920} height={1080} />
    <Composition id="GuideQ1" component={GuideQ1} durationInFrames={TOTAL_Q1} fps={G_FPS} width={1920} height={1080} />
    <Composition id="GuideQ2" component={GuideQ2} durationInFrames={TOTAL_Q2} fps={G_FPS} width={1920} height={1080} />
    <Composition id="GuideQ3" component={GuideQ3} durationInFrames={TOTAL_Q3} fps={G_FPS} width={1920} height={1080} />
  </>
);
