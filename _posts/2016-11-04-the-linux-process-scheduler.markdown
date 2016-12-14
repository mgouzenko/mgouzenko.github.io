---
layout: post
title:  "Linux Scheduler Series: Introduction"
date:   2016-11-04 20:17:34
categories: jekyll update
series:  "The Linux Scheduler"
---

{% include series.html %}

## Introduction
I'm writing this series after TA-ing an operating systems class for two
semesters. Each year, tears begin to flow by the time we get to the infamous
Scheduler Assignment - where students are asked to implement a
round-robin scheduler in the Linux kernel. The assignment is known to leave
relatively competent programmers in shambles. I don't blame them; the seemingly
simple task of writing a round robin scheduler is complicated by two
confounding factors:

  * The Linux scheduler is cryptic as hell and on top of that, very poorly
  documented.
  * Bugs in scheduler code will often trigger kernel panic, freezing the system
  without providing any logs or meaningful error messages.

I hope to ease students' suffering by addressing the first bullet point. In
this series, I will explain how the scheduler's infrastructure is set up,
emphasizing how one may leverage its modularity to plug in their own scheduler.


We'll begin by examining the basic role of the core scheduler and how the rest
of the kernel interfaces with it. Then, we'll look at `sched_class`, the
modular data structure that permits various scheduling algorithms to live and
operate side by side in the kernel. In the process, I will give a high-level
tour of Linux's Completely Fair Scheduler (CFS). Finally, we'll touch on the
concept of group scheduling.

## A Top Down Approach
Initially, I'll treat the scheduler as a black box. I will make gross
over-simplifications but note very clearly when I do so. Little by little, we
will delve into the scheduler's internals, unfolding the truth behind these
simplifications. By the end of this series, you should be able to start
tackling the problem of writing your own working scheduler.

## Disclaimer
I'm not an expert kernel hacker. I'm just a student who has spent a modest
number of hours reading, screaming at, and sobbing over kernel code. If I make
a mistake, please point it out in the comments section, and I'll do my best to
correct it.
