---
layout: post
title:  "The Linux Process Scheduler"
date:   2016-11-04 20:17:34
categories: jekyll update
---

I'm writing this post after TA-ing an operating systems class for two
semesters. Each year, tears begin to flow by the time we get to the infamous
Scheduler Assignment, where students are asked to implement a simple
round-robin scheduler in the Linux kernel. The assignment is known to leave
relatively competent programmers in shambles - bloodshot and disheveled,
screaming profanities at their computer screens as they desperately search for
the bug that is hanging their OS. I don't blame them; the seemingly simple task
of writing a round robin scheduler is complicated by two confounding factors:

  * The Linux scheduler is cryptic as hell and on top of that, very poorly documented.
  * Bugs in scheduler code will cause the OS to go into kernel panic, freezing the system without providing any logs or meaningful error messages.

In this post, I hope to ease students' suffering by addressing the first bullet
point. In particular, I will try to explain how key components of the scheduler
work and how one may plug their own scheduler into the existing infrastructure.

# A Top Down Approach to Understanding the Scheduler
In my explanation, I'm going to start off treating the scheduler as a black
box. I start by explaining the APIs that the rest of the OS uses to interact
with the scheduler. In the process, I will make gross over-simplifications, and
I will note very clearly when I do so. Little by little, we will delve into the
scheduler's internals, unfolding the truth behind these simplifications. By the
end of this post, you should be able to start tackling the problem of writing
your own working scheduler.

# What is the scheduler?
